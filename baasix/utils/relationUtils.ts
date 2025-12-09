import { relations, type InferSelectModel, sql } from 'drizzle-orm';
import { pgTable } from 'drizzle-orm/pg-core';
import { getDatabase } from './db.js';
import type { AssociationType, AssociationDefinition, RelationalResult } from '../types/index.js';
import type ItemsService from '../services/ItemsService.js';

/**
 * Relation builder for dynamic schemas
 */
export class RelationBuilder {
  private relationsMap: Map<string, Record<string, AssociationDefinition>> = new Map();

  /**
   * Store association definitions for a table
   * Relations will be resolved at query time using Drizzle's query API
   * Note: This merges with existing associations instead of replacing them
   */
  storeAssociations(
    tableName: string,
    associations: Record<string, AssociationDefinition>
  ): void {
    console.log(`[RelationBuilder] Storing associations for ${tableName}:`, Object.keys(associations));

    // Get existing associations for this table
    const existing = this.relationsMap.get(tableName) || {};

    // Merge new associations with existing ones
    const merged = { ...existing, ...associations };

    console.log(`[RelationBuilder] After merge, ${tableName} has:`, Object.keys(merged));
    this.relationsMap.set(tableName, merged);
  }

  /**
   * Get associations for a table
   */
  getAssociations(tableName: string): Record<string, AssociationDefinition> | undefined {
    const assocs = this.relationsMap.get(tableName);
    console.log(`[RelationBuilder] Retrieved associations for ${tableName}:`, assocs ? Object.keys(assocs) : 'none');
    return assocs;
  }

  /**
   * Get all associations
   */
  getAllAssociations(): Map<string, Record<string, AssociationDefinition>> {
    return this.relationsMap;
  }

  /**
   * Get foreign key column name for a relation
   */
  getForeignKey(assoc: AssociationDefinition, defaultKey?: string): string {
    return assoc.foreignKey || defaultKey || `${assoc.model.toLowerCase()}Id`;
  }

  /**
   * Check if an association is a one-to-many type
   */
  isOneToMany(assoc: AssociationDefinition): boolean {
    return assoc.type === 'HasMany';
  }

  /**
   * Check if an association is a many-to-one type
   */
  isManyToOne(assoc: AssociationDefinition): boolean {
    return assoc.type === 'BelongsTo';
  }

  /**
   * Check if an association is a many-to-many type
   */
  isManyToMany(assoc: AssociationDefinition): boolean {
    return assoc.type === 'BelongsToMany';
  }
}

/**
 * Singleton instance
 */
export const relationBuilder = new RelationBuilder();

/**
 * Helper to create foreign key constraint SQL
 */
export function createForeignKeySQL(
  tableName: string,
  columnName: string,
  referencedTable: string,
  referencedColumn: string = 'id',
  onDelete: string = 'CASCADE',
  onUpdate: string = 'CASCADE'
): string {
  const constraintName = `fk_${tableName}_${columnName}`;
  
  return `
    ALTER TABLE "${tableName}"
    ADD CONSTRAINT "${constraintName}"
    FOREIGN KEY ("${columnName}")
    REFERENCES "${referencedTable}"("${referencedColumn}")
    ON DELETE ${onDelete}
    ON UPDATE ${onUpdate}
  `.trim();
}

/**
 * Helper to check if a field is a polymorphic relation
 */
export function isPolymorphicRelation(assoc: AssociationDefinition): boolean {
  return assoc.type === 'M2A' || assoc.polymorphic === true;
}

/**
 * Helper to get polymorphic field names
 */
export function getPolymorphicFields(
  relationName: string
): { typeField: string; idField: string } {
  return {
    typeField: `${relationName}Type`,
    idField: `${relationName}Id`,
  };
}

/**
 * Build junction table for many-to-many relations
 * Example: UserRoles for User <-> Role
 */
export function buildJunctionTable(
  table1Name: string,
  table2Name: string,
  table1Key: string = 'id',
  table2Key: string = 'id'
): string {
  const junctionName = `${table1Name}${table2Name}`;
  const fk1 = `${table1Name}${table1Key.charAt(0).toUpperCase()}${table1Key.slice(1)}`;
  const fk2 = `${table2Name}${table2Key.charAt(0).toUpperCase()}${table2Key.slice(1)}`;

  return `
    CREATE TABLE IF NOT EXISTS "${junctionName}" (
      "${fk1}" UUID NOT NULL,
      "${fk2}" UUID NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("${fk1}", "${fk2}"),
      FOREIGN KEY ("${fk1}") REFERENCES "${table1Name}"("${table1Key}") ON DELETE CASCADE,
      FOREIGN KEY ("${fk2}") REFERENCES "${table2Name}"("${table2Key}") ON DELETE CASCADE
    )
  `.trim();
}

/**
 * Convert Sequelize association type to Drizzle relation type
 */
export function sequelizeTosDrizzleRelationType(
  sequelizeType: string
): 'one' | 'many' | null {
  switch (sequelizeType) {
    case 'HasMany':
    case 'BelongsToMany':
      return 'many';
    case 'HasOne':
    case 'BelongsTo':
      return 'one';
    default:
      return null;
  }
}

// ============================================================================
// Relational Data Processing
// ============================================================================

/**
 * Process relational data - extract nested objects/arrays
 * @param collection - Collection name
 * @param data - Data to process
 * @param service - Service instance
 * @param ItemsServiceClass - ItemsService class for creating related service instances
 */
export async function processRelationalData(
  collection: string,
  data: Record<string, any>,
  service: any,
  ItemsServiceClass: typeof ItemsService
): Promise<RelationalResult> {
  console.log(`[RelationUtils] Processing relational data for ${collection}`);

  const result: Record<string, any> = {};
  const deferredHasMany: any[] = [];
  const deferredM2M: any[] = [];
  const deferredM2A: any[] = [];

  // Get relation metadata for this collection
  const associations = relationBuilder.getAssociations(collection);

  console.log(`[RelationUtils] Associations for ${collection}:`, associations ? Object.keys(associations) : 'none');

  if (!associations) {
    // No relations defined, return data as-is
    console.log(`[RelationUtils] No associations found for ${collection}, returning data as-is`);
    return {
      result: { ...data },
      deferredHasMany,
      deferredM2M,
      deferredM2A
    };
  }

  // Process BelongsTo relationships first - they need to be created/resolved before main record
  for (const [key, value] of Object.entries(data)) {
    const association = associations[key];

    if (!association || value == null) {
      // Not a relation or value is null - include in result
      result[key] = value;
      continue;
    }

    if (association.type === 'BelongsTo') {
      console.log(`[RelationUtils] Processing BelongsTo relation: ${key}`);

      // Use passed ItemsService class to create related service
      const relatedService = new ItemsServiceClass(association.model, {
        accountability: service.accountability,
        tenant: service.tenant
      });

      const foreignKey = association.foreignKey || `${key}_Id`;

      if (typeof value === 'object' && !value.id) {
        // Create new related record
        console.log(`[RelationUtils] Creating new ${association.model} for ${key}`);
        const newRelatedId = await relatedService.createOne(value, { bypassPermissions: true });
        console.log(`[RelationUtils] Created ${association.model} with ID:`, newRelatedId);
        console.log(`[RelationUtils] Setting ${foreignKey} =`, newRelatedId);
        result[foreignKey] = newRelatedId;
      } else if (typeof value === 'object' && value.id) {
        // Reference existing record (optionally update it)
        console.log(`[RelationUtils] Using existing ${association.model} ${value.id} for ${key}`);

        // If there are other fields besides id, update the related record
        const updateFields = { ...value };
        delete updateFields.id;

        if (Object.keys(updateFields).length > 0) {
          await relatedService.updateOne(value.id, updateFields, { bypassPermissions: true });
        }

        result[foreignKey] = value.id;
      } else {
        // Use existing record ID directly
        result[foreignKey] = value;
      }

      // Don't include the relation name in result (we stored the foreignKey instead)
      // delete result[key]; - already not added
    } else {
      // Not a BelongsTo - include in result for now, process later
      result[key] = value;
    }
  }

  // Process HasMany, BelongsToMany, and M2A relationships - these are deferred
  for (const [key, value] of Object.entries(data)) {
    const association = associations[key];

    if (!association || value == null) continue;

    // Check for M2A (polymorphic) relations first
    // M2A is stored as HasMany with polymorphic: true
    if (isPolymorphicRelation(association)) {
      if (Array.isArray(value)) {
        console.log(`[RelationUtils] Deferring M2A relation: ${key}`);
        deferredM2A.push({ association: key, associationInfo: association, value });
      }
      // Remove from result
      delete result[key];
    } else if (association.type === 'HasMany') {
      if (Array.isArray(value)) {
        console.log(`[RelationUtils] Deferring HasMany relation: ${key}`);
        deferredHasMany.push({ association: key, associationInfo: association, value });
      }
      // Remove from result
      delete result[key];
    } else if (association.type === 'BelongsToMany') {
      if (Array.isArray(value)) {
        console.log(`[RelationUtils] Deferring BelongsToMany relation: ${key}`);
        deferredM2M.push({ association: key, associationInfo: association, value });
      }
      // Remove from result
      delete result[key];
    }
  }

  console.log(`[RelationUtils] Processed relational data:`, {
    resultKeys: Object.keys(result),
    deferredHasManyCount: deferredHasMany.length,
    deferredM2MCount: deferredM2M.length,
    deferredM2ACount: deferredM2A.length
  });

  return {
    result,
    deferredHasMany,
    deferredM2M,
    deferredM2A
  };
}

/**
 * Handle HasMany relationship after main record is created
 *
 * @param item - The created/updated main record with its ID
 * @param association - Name of the association
 * @param associationInfo - Metadata about the association
 * @param value - Array of related items to create/update
 * @param service - The service instance
 * @param ItemsServiceClass - ItemsService class for creating related service instances
 * @param transaction - Optional transaction
 */
export async function handleHasManyRelationship(
  item: any,
  association: string,
  associationInfo: any,
  value: any[],
  service: any,
  ItemsServiceClass: typeof ItemsService,
  transaction?: any
): Promise<void> {
  console.log(`[RelationUtils] Handling HasMany relationship: ${association}`);

  if (!Array.isArray(value)) {
    console.warn(`[RelationUtils] HasMany value is not an array for ${association}`);
    return;
  }

  // Use passed ItemsService class to create related service
  const relatedService = new ItemsServiceClass(associationInfo.model, {
    accountability: service.accountability,
    tenant: service.tenant
  });

  const foreignKey = associationInfo.foreignKey || `${service.collection.toLowerCase()}_Id`;
  const parentId = item[service.primaryKey];

  // Get existing related records
  const existingRecordsResult = await relatedService.readByQuery({
    filter: { [foreignKey]: { eq: parentId } }
  }, true); // bypassPermissions

  const existingRecords = existingRecordsResult.data || [];

  // Create a set of existing IDs
  const existingIds = new Set(existingRecords.map((record: any) => record.id));

  // Create a set of IDs from the update value
  const updateIds = new Set(value.filter(item => item.id).map(item => item.id));

  // Find records to delete or unlink
  const idsToDelete = [...existingIds].filter(id => !updateIds.has(id));

  if (idsToDelete.length > 0) {
    console.log(`[RelationUtils] Removing ${idsToDelete.length} orphaned HasMany records`);

    // Check if foreign key is nullable by looking at schema
    const { schemaManager } = await import('./schemaManager.js');
    const targetSchema = schemaManager.getSchemaDefinition(associationInfo.model);
    const fkField = targetSchema?.fields?.[foreignKey];
    const allowsNull = !fkField || fkField.allowNull !== false;

    // For junction tables or non-nullable foreign keys, delete the records
    // For nullable foreign keys, just set the FK to null (unlink)
    const isJunctionTable = associationInfo.model.endsWith('_junction');

    if (isJunctionTable || !allowsNull) {
      await Promise.all(
        idsToDelete.map(async (id) => {
          await relatedService.deleteOne(id, { bypassPermissions: true, transaction });
        })
      );
    } else {
      // Set foreign key to null instead of deleting
      await Promise.all(
        idsToDelete.map(async (id) => {
          await relatedService.updateOne(id, { [foreignKey]: null }, { bypassPermissions: true, transaction });
        })
      );
    }
  }

  // Create or update the related records
  await Promise.all(
    value.map(async (relItem) => {
      const data = { ...relItem };

      // Set the foreign key to link to parent
      data[foreignKey] = parentId;

      if (relItem.id) {
        // Update existing record
        console.log(`[RelationUtils] Updating HasMany record ${relItem.id} for ${association}`);
        await relatedService.updateOne(relItem.id, data, { bypassPermissions: true, transaction });
      } else {
        // Create new record
        console.log(`[RelationUtils] Creating new HasMany record for ${association}`);
        await relatedService.createOne(data, { bypassPermissions: true, transaction });
      }
    })
  );

  console.log(`[RelationUtils] Completed HasMany relationship: ${association}`);
}

/**
 * Handle M2M (BelongsToMany) relationship after main record is created
 *
 * @param item - The created/updated main record with its ID
 * @param association - Name of the association
 * @param associationInfo - Metadata about the association
 * @param value - Array of related items (IDs or objects with IDs)
 * @param service - The service instance
 * @param ItemsServiceClass - ItemsService class for creating related service instances
 * @param transaction - Optional transaction
 */
export async function handleM2MRelationship(
  item: any,
  association: string,
  associationInfo: any,
  value: any[],
  service: any,
  ItemsServiceClass: typeof ItemsService,
  transaction?: any
): Promise<void> {
  console.log(`[RelationUtils] Handling M2M relationship: ${association}`);

  if (!Array.isArray(value)) {
    console.warn(`[RelationUtils] M2M value is not an array for ${association}`);
    return;
  }

  // Use statically imported getDatabase and sql
  const db = getDatabase();

  // Use transaction if provided, otherwise use db
  const dbOrTx = transaction || db;

  // Get junction table name from association metadata
  const junctionTable = associationInfo.through || `${service.collection}_${associationInfo.model}_junction`;
  console.log(`[RelationUtils] Using junction table: ${junctionTable}`);

  // Define foreign key column names
  const sourceKey = associationInfo.foreignKey || `${service.collection}_id`;
  const targetKey = associationInfo.otherKey || `${associationInfo.model}_id`;
  const parentId = item[service.primaryKey];

  console.log(`[RelationUtils] M2M keys: sourceKey=${sourceKey}, targetKey=${targetKey}, parentId=${parentId}`);

  // Process value array - create any new related records first
  const processedIds: any[] = [];

  for (const targetItem of value) {
    if (typeof targetItem === 'object' && targetItem !== null) {
      if (targetItem.id) {
        // Existing record - just use the ID
        processedIds.push(targetItem.id);
      } else {
        // New record - create it first using passed ItemsService class
        const relatedService = new ItemsServiceClass(associationInfo.model, {
          accountability: service.accountability,
          tenant: service.tenant
        });

        console.log(`[RelationUtils] Creating new ${associationInfo.model} for M2M relation`);
        const newId = await relatedService.createOne(targetItem, { bypassPermissions: true, transaction });
        processedIds.push(newId);
      }
    } else {
      // Direct ID
      processedIds.push(targetItem);
    }
  }

  // Clear existing relations for this record
  console.log(`[RelationUtils] Clearing existing M2M relations in ${junctionTable}`);
  await dbOrTx.execute(sql`
    DELETE FROM "${sql.raw(junctionTable)}"
    WHERE "${sql.raw(sourceKey)}" = ${parentId}
  `);

  // Create new junction records
  if (processedIds.length > 0) {
    console.log(`[RelationUtils] Creating ${processedIds.length} M2M junction records`);

    for (const targetId of processedIds) {
      await dbOrTx.execute(sql`
        INSERT INTO "${sql.raw(junctionTable)}" ("${sql.raw(sourceKey)}", "${sql.raw(targetKey)}")
        VALUES (${parentId}, ${targetId})
      `);
    }
  }

  console.log(`[RelationUtils] Completed M2M relationship: ${association}`);
}

/**
 * Handle M2A (polymorphic) relationship after main record is created
 *
 * @param item - The created/updated main record with its ID
 * @param association - Name of the association
 * @param associationInfo - Metadata about the association
 * @param value - Array of polymorphic relation items
 * @param service - The service instance
 * @param ItemsServiceClass - ItemsService class (not used in M2A but kept for consistency)
 * @param transaction - Optional transaction
 */
export async function handleM2ARelationship(
  item: any,
  association: string,
  associationInfo: any,
  value: any[],
  service: any,
  ItemsServiceClass: typeof ItemsService,
  transaction?: any
): Promise<void> {
  console.log(`[RelationUtils] Handling M2A relationship: ${association}`);

  if (!Array.isArray(value)) {
    console.warn(`[RelationUtils] M2A value is not an array for ${association}`);
    return;
  }

  // Use statically imported getDatabase and sql
  const db = getDatabase();

  // Use transaction if provided, otherwise use db
  const dbOrTx = transaction || db;

  // M2A uses a polymorphic junction table
  // The junction table name is stored in 'through' property
  const junctionTable = associationInfo.through;
  if (!junctionTable) {
    console.error(`[RelationUtils] M2A relation ${association} missing 'through' property`);
    return;
  }
  console.log(`[RelationUtils] Using M2A junction table: ${junctionTable}`);

  // Define column names for polymorphic relation
  const sourceKey = `${service.collection}_id`;
  const targetKey = 'item_id'; // Polymorphic ID field
  const typeKey = 'collection'; // Polymorphic type field
  const parentId = item[service.primaryKey];

  console.log(`[RelationUtils] M2A keys: sourceKey=${sourceKey}, targetKey=${targetKey}, typeKey=${typeKey}`);

  // Clear existing relations for this record
  console.log(`[RelationUtils] Clearing existing M2A relations in ${junctionTable}`);
  await dbOrTx.execute(sql`
    DELETE FROM "${sql.raw(junctionTable)}"
    WHERE "${sql.raw(sourceKey)}" = ${parentId}
  `);

  // Create new polymorphic junction records
  if (value.length > 0) {
    console.log(`[RelationUtils] Creating ${value.length} M2A junction records`);

    for (const item of value) {
      // Extract the target type and ID
      const targetType = item.type || item.collection;
      const targetId = item.item_id || item.item || item.id;

      if (!targetType || !targetId) {
        console.warn(`[RelationUtils] Skipping invalid M2A item:`, item);
        continue;
      }

      console.log(`[RelationUtils] Creating M2A junction: ${sourceKey}=${parentId}, ${typeKey}=${targetType}, ${targetKey}=${targetId}`);

      await dbOrTx.execute(sql`
        INSERT INTO "${sql.raw(junctionTable)}" ("${sql.raw(sourceKey)}", "${sql.raw(typeKey)}", "${sql.raw(targetKey)}")
        VALUES (${parentId}, ${targetType}, ${targetId})
      `);
    }
  }

  console.log(`[RelationUtils] Completed M2A relationship: ${association}`);
}

/**
 * Handle related records before delete (CASCADE, SET NULL, etc.)
 * Processes HasMany, HasOne, and BelongsToMany relationships based on onDelete settings
 */
export async function handleRelatedRecordsBeforeDelete(
  item: any,
  service: any,
  transaction?: any
): Promise<void> {
  console.log(`[RelationUtils] Handling related records before delete for ${service.collection}`);

  const associations = relationBuilder.getAssociations(service.collection);
  if (!associations) {
    return;
  }

  const db = getDatabase();
  const dbOrTx = transaction || db;

  for (const [associationName, association] of Object.entries(associations)) {
    const onDelete = association.onDelete || 'CASCADE';

    if (association.type === 'HasMany') {
      await handleHasManyDelete(item, association, associationName, service, dbOrTx, onDelete);
    } else if (association.type === 'HasOne') {
      await handleHasOneDelete(item, association, associationName, service, dbOrTx, onDelete);
    } else if (association.type === 'BelongsToMany') {
      await handleBelongsToManyDelete(item, association, associationName, service, dbOrTx);
    } else if (isPolymorphicRelation(association)) {
      await handleM2ADelete(item, association, associationName, service, dbOrTx);
    }
  }
}

/**
 * Handle HasMany delete - CASCADE or SET NULL related records
 */
async function handleHasManyDelete(
  item: any,
  association: AssociationDefinition,
  associationName: string,
  service: any,
  dbOrTx: any,
  onDelete: string
): Promise<void> {
  const { schemaManager } = await import('./schemaManager.js');
  const targetTable = schemaManager.getTable(association.model);

  if (!targetTable) {
    console.warn(`[RelationUtils] Target table ${association.model} not found for HasMany delete`);
    return;
  }

  const foreignKey = association.foreignKey || `${service.collection.toLowerCase()}_Id`;
  const parentId = item[service.primaryKey];

  if (parentId === undefined || parentId === null) {
    console.warn(`[RelationUtils] Cannot delete HasMany records - parentId is ${parentId}`);
    return;
  }

  console.log(`[RelationUtils] HandleHasManyDelete: ${associationName}, onDelete=${onDelete}`);

  if (onDelete === 'CASCADE') {
    // Delete all related records
    const fkColumn = targetTable[foreignKey];
    if (fkColumn) {
      const { eq } = await import('drizzle-orm');
      await dbOrTx.delete(targetTable).where(eq(fkColumn, parentId));
      console.log(`[RelationUtils] Cascaded delete for ${associationName}`);
    }
  } else if (onDelete === 'SET NULL') {
    // Set foreign key to null on related records
    const fkColumn = targetTable[foreignKey];
    if (fkColumn) {
      const { eq } = await import('drizzle-orm');
      await dbOrTx.update(targetTable).set({ [foreignKey]: null }).where(eq(fkColumn, parentId));
      console.log(`[RelationUtils] Set null for ${associationName}`);
    }
  }
  // RESTRICT and NO ACTION are handled by database constraints
}

/**
 * Handle HasOne delete - CASCADE or SET NULL the related record
 */
async function handleHasOneDelete(
  item: any,
  association: AssociationDefinition,
  associationName: string,
  service: any,
  dbOrTx: any,
  onDelete: string
): Promise<void> {
  // HasOne delete works the same as HasMany, just for a single record
  await handleHasManyDelete(item, association, associationName, service, dbOrTx, onDelete);
}

/**
 * Handle BelongsToMany delete - Remove junction table records
 */
async function handleBelongsToManyDelete(
  item: any,
  association: AssociationDefinition,
  associationName: string,
  service: any,
  dbOrTx: any
): Promise<void> {
  const junctionTable = association.through;
  if (!junctionTable) {
    console.warn(`[RelationUtils] No junction table defined for ${associationName}`);
    return;
  }

  const sourceKey = association.foreignKey || `${service.collection}_id`;
  const parentId = item[service.primaryKey];

  if (parentId === undefined || parentId === null) {
    console.warn(`[RelationUtils] Cannot delete M2M junction records - parentId is ${parentId}`);
    return;
  }

  console.log(`[RelationUtils] Removing M2M junction records from ${junctionTable} for ${associationName}`);

  await dbOrTx.execute(sql`
    DELETE FROM "${sql.raw(junctionTable)}"
    WHERE "${sql.raw(sourceKey)}" = ${parentId}
  `);
}

/**
 * Handle M2A (polymorphic) delete - Remove polymorphic junction table records
 */
async function handleM2ADelete(
  item: any,
  association: AssociationDefinition,
  associationName: string,
  service: any,
  dbOrTx: any
): Promise<void> {
  const junctionTable = association.through;
  if (!junctionTable) {
    console.warn(`[RelationUtils] No junction table defined for M2A ${associationName}`);
    return;
  }

  const sourceKey = `${service.collection}_id`;
  const parentId = item[service.primaryKey];

  if (parentId === undefined || parentId === null) {
    console.warn(`[RelationUtils] Cannot delete M2A junction records - parentId is ${parentId}`);
    return;
  }

  console.log(`[RelationUtils] Removing M2A junction records from ${junctionTable} for ${associationName}`);

  await dbOrTx.execute(sql`
    DELETE FROM "${sql.raw(junctionTable)}"
    WHERE "${sql.raw(sourceKey)}" = ${parentId}
  `);
}

/**
 * Validate relational data - ensures referenced records exist
 */
export async function validateRelationalData(
  data: Record<string, any>,
  collection: string,
  service: any
): Promise<void> {
  console.log(`[RelationUtils] Validating relational data for ${collection}`);

  const associations = relationBuilder.getAssociations(collection);
  if (!associations) {
    return;
  }

  const errors: Array<{ field: string; message: string }> = [];

  for (const [key, value] of Object.entries(data)) {
    const association = associations[key];
    if (!association || value == null) continue;

    try {
      await validateRelation(association, key, value, service);
    } catch (error: any) {
      errors.push({ field: key, message: error.message });
    }
  }

  if (errors.length > 0) {
    const { APIError } = await import('./errorHandler.js');
    throw new APIError('Validation failed for relational data', 400, errors);
  }
}

/**
 * Validate a single relation - check if referenced records exist
 */
async function validateRelation(
  association: AssociationDefinition,
  fieldName: string,
  value: any,
  service: any
): Promise<void> {
  // Dynamically import ItemsService to avoid circular dependency
  const { default: ItemsService } = await import('../services/ItemsService.js');

  const relatedService = new ItemsService(association.model, {
    accountability: service.accountability,
    tenant: service.tenant
  });

  switch (association.type) {
    case 'BelongsTo':
      if (typeof value === 'object' && !value.id) {
        // New record to be created - validate will happen during create
        return;
      } else {
        const id = typeof value === 'object' ? value.id : value;
        try {
          await relatedService.readOne(id, {}, true); // bypassPermissions
        } catch (error) {
          throw new Error(`Related record not found: ${id}`);
        }
      }
      break;

    case 'HasMany':
    case 'BelongsToMany':
      if (!Array.isArray(value)) {
        throw new Error(`Value must be an array for ${fieldName}`);
      }

      for (const item of value) {
        if (typeof item === 'object' && !item.id) {
          // New record to be created - validation will happen during create
          continue;
        }

        const id = typeof item === 'object' ? item.id : item;
        try {
          await relatedService.readOne(id, {}, true); // bypassPermissions
        } catch (error) {
          throw new Error(`Related record not found: ${id}`);
        }
      }
      break;
  }
}

/**
 * Resolve circular dependencies in data
 * Detects BelongsTo relations that reference the parent record being created
 */
export async function resolveCircularDependencies(
  data: Record<string, any>,
  collection: string,
  service: any
): Promise<{ resolvedData: Record<string, any>; deferredFields: Array<{ field: string; value: any }> }> {
  console.log(`[RelationUtils] Resolving circular dependencies for ${collection}`);

  const associations = relationBuilder.getAssociations(collection);
  if (!associations) {
    return { resolvedData: data, deferredFields: [] };
  }

  const resolvedData: Record<string, any> = { ...data };
  const deferredFields: Array<{ field: string; value: any }> = [];

  for (const [key, value] of Object.entries(data)) {
    const association = associations[key];
    if (!association || value == null) continue;

    if (hasCircularDependency(association, value, service.primaryKey)) {
      console.log(`[RelationUtils] Found circular dependency in ${key}`);
      deferredFields.push({ field: key, value });
      delete resolvedData[key];
    }
  }

  console.log(`[RelationUtils] Resolved ${deferredFields.length} circular dependencies`);

  return { resolvedData, deferredFields };
}

/**
 * Check if a value has circular dependency
 * A circular dependency occurs when a BelongsTo relation references the parent's primary key
 */
function hasCircularDependency(
  association: AssociationDefinition,
  value: any,
  primaryKey: string
): boolean {
  if (association.type !== 'BelongsTo') return false;

  // Check if the value is an object that references the parent's primary key
  // This happens when creating a record that has a BelongsTo pointing back to itself
  return typeof value === 'object' && !value.id && value[primaryKey];
}

/**
 * Process deferred fields after main record creation
 * Updates related records to link back to the newly created parent
 */
export async function processDeferredFields(
  item: any,
  deferredFields: Array<{ field: string; value: any }>,
  service: any,
  transaction?: any
): Promise<void> {
  if (deferredFields.length === 0) return;

  console.log(`[RelationUtils] Processing ${deferredFields.length} deferred fields`);

  const associations = relationBuilder.getAssociations(service.collection);
  if (!associations) return;

  // Dynamically import ItemsService to avoid circular dependency
  const { default: ItemsService } = await import('../services/ItemsService.js');

  for (const { field, value } of deferredFields) {
    const association = associations[field];
    if (!association) continue;

    // Create a service for the related model
    const relatedService = new ItemsService(association.model, {
      accountability: service.accountability,
      tenant: service.tenant
    });

    // Update the related record to link to the new parent
    const foreignKey = association.foreignKey || `${field}_Id`;

    if (value[service.primaryKey]) {
      console.log(`[RelationUtils] Updating deferred ${field}: setting ${foreignKey} = ${item[service.primaryKey]}`);

      await relatedService.updateOne(
        value[service.primaryKey],
        { [foreignKey]: item[service.primaryKey] },
        { transaction, bypassPermissions: true }
      );
    }
  }
}
