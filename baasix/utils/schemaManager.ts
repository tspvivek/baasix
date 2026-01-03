import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { eq, inArray } from 'drizzle-orm';
import argon2 from 'argon2';
import { getDatabase, getSqlClient, isPgVersionAtLeast } from './db.js';
import { mapJsonTypeToDrizzle, isRelationField } from './typeMapper.js';
import { relationBuilder, createForeignKeySQL } from './relationUtils.js';
import systemSchemaModule from './systemschema.js';
import env from './env.js';
import type { SchemaDefinition } from '../types/index.js';

const systemSchemas = systemSchemaModule.schemas;

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_schemaManager: SchemaManager | undefined;
}

/**
 * baasix_SchemaDefinition table schema
 * Note: This is duplicated from schema.ts to avoid circular dependency
 */
const baasixSchemaDefinition = pgTable('baasix_SchemaDefinition', {
  collectionName: text('collectionName').primaryKey().notNull(),
  schema: jsonb('schema').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow(),
});

/**
 * Manages dynamic schema generation from JSON definitions
 */
export class SchemaManager {
  private static instance: SchemaManager;
  private schemas: Map<string, any> = new Map(); // Stores Drizzle table schemas
  private schemaDefinitions: Map<string, any> = new Map(); // Stores JSON schema definitions
  private relations: Map<string, any> = new Map();
  private initialized = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): SchemaManager {
    // Use globalThis to ensure singleton across different module loading paths
    if (!globalThis.__baasix_schemaManager) {
      globalThis.__baasix_schemaManager = new SchemaManager();
    }
    return globalThis.__baasix_schemaManager;
  }

  /**
   * Initialize schema manager by loading all schemas from database
   * Flow matches Sequelize implementation:
   * 1. Ensure SchemaDefinition table exists
   * 2. Ensure system schemas are in SchemaDefinition table
   * 3. Create tables for schemas that need syncing
   * 4. Load all schemas
   * 5. Seed database if empty
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('SchemaManager already initialized.');
      return;
    }

    console.log('Initializing Schema Manager...');

    try {
      // Step 0: Enable required PostgreSQL extensions
      await this.enablePostgresExtensions();
      
      // Step 1: Ensure baasix_SchemaDefinition table exists
      await this.ensureSchemaDefinitionTable();
      
      // Step 2: Ensure system schemas are in the table
      const needSyncing = await this.ensureSystemSchemas();
      
      // Step 3: Create/sync tables for schemas that need it
      if (needSyncing.length > 0) {
        console.info('Need to sync the following schemas:', needSyncing);
        await this.loadAndCreateAllSchemas(needSyncing);
      } else {
        console.info('No system schemas need syncing.');
      }
      
      // Step 4: Load all schemas into memory
      await this.loadAllSchemas();

      this.initialized = true;
      console.log('Schema Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Schema Manager:', error);
      throw error;
    }
  }

  /**
   * Enable required PostgreSQL extensions
   */
  private async enablePostgresExtensions(): Promise<void> {
    const sql = getSqlClient();
    
    try {
      // Enable pgcrypto for gen_random_uuid()
      await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      console.log('PostgreSQL extension pgcrypto enabled');

      // Enable PostGIS if configured
      if (env.get('DATABASE_POSTGIS') === 'true') {
        await sql.unsafe('CREATE EXTENSION IF NOT EXISTS postgis');
        console.log('PostgreSQL extension postgis enabled');
      }
    } catch (error) {
      console.error('Failed to enable PostgreSQL extensions:', error);
      throw error;
    }
  }

  /**
   * Ensure baasix_SchemaDefinition table exists
   */
  private async ensureSchemaDefinitionTable(): Promise<void> {
    const sql = getSqlClient();
    
    // Check if table exists
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'baasix_SchemaDefinition'
      )
    `;

    if (!result[0].exists) {
      console.log('Creating baasix_SchemaDefinition table...');
      
      await sql`
        CREATE TABLE "baasix_SchemaDefinition" (
          "collectionName" TEXT PRIMARY KEY NOT NULL,
          schema JSONB NOT NULL,
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      console.log('SchemaDefinition table created.');
    }
  }

  /**
   * Ensure system schemas are in the baasix_SchemaDefinition table
   * Returns list of schemas that need syncing
   */
  private async ensureSystemSchemas(): Promise<string[]> {
    const db = getDatabase();
    const needUpdate: string[] = [];

    for (const schemaData of systemSchemas) {
      // Prepare schema with timestamp fields added if timestamps: true
      const schemaToStore = JSON.parse(JSON.stringify(schemaData.schema));
      if (schemaToStore.timestamps !== false) {
        // Add createdAt and updatedAt fields to schema definition if not already present
        if (!schemaToStore.fields.createdAt) {
          schemaToStore.fields.createdAt = { 
            type: "DateTime", 
            allowNull: true, 
            SystemGenerated: "true",
            defaultValue: { type: "NOW" }
          };
        }
        if (!schemaToStore.fields.updatedAt) {
          schemaToStore.fields.updatedAt = { 
            type: "DateTime", 
            allowNull: true, 
            SystemGenerated: "true",
            defaultValue: { type: "NOW" }
          };
        }
      }
      // Add deletedAt if paranoid mode
      if (schemaToStore.paranoid && !schemaToStore.fields.deletedAt) {
        schemaToStore.fields.deletedAt = { 
          type: "DateTime", 
          allowNull: true, 
          SystemGenerated: "true"
        };
      }

      // Check if schema already exists
      const existing = await db
        .select()
        .from(baasixSchemaDefinition)
        .where(eq(baasixSchemaDefinition.collectionName, schemaData.collectionName))
        .limit(1);

      if (existing.length === 0) {
        // Insert new schema
        await db.insert(baasixSchemaDefinition).values({
          collectionName: schemaData.collectionName,
          schema: schemaToStore as any,
        });
        console.log(`Added system schema: ${schemaData.collectionName}`);
        needUpdate.push(schemaData.collectionName);
      } else {
        // Compare and update if needed (add new fields and sync schema-level properties)
        const existingSchema = existing[0].schema as any;
        let hasChanges = false;

        // Check for new/missing fields (including timestamp fields)
        const newFields = Object.keys(schemaToStore.fields).filter(
          (field) => !existingSchema.fields[field]
        );

        if (newFields.length > 0) {
          for (const field of newFields) {
            existingSchema.fields[field] = schemaToStore.fields[field];
          }
          hasChanges = true;
        }

        // Sync schema-level properties (timestamps, paranoid, usertrack, indexes)
        // Helper function for deep equality comparison (ignores property order)
        const deepEqual = (a: any, b: any): boolean => {
          if (a === b) return true;
          if (a == null || b == null) return a === b;
          if (typeof a !== typeof b) return false;
          if (typeof a !== 'object') return a === b;
          
          if (Array.isArray(a) !== Array.isArray(b)) return false;
          
          if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            // For arrays, compare each element
            // Sort arrays of objects by 'name' field for stable comparison
            const sortKey = (item: any) => item?.name || JSON.stringify(item);
            const sortedA = [...a].sort((x, y) => String(sortKey(x)).localeCompare(String(sortKey(y))));
            const sortedB = [...b].sort((x, y) => String(sortKey(x)).localeCompare(String(sortKey(y))));
            return sortedA.every((item, i) => deepEqual(item, sortedB[i]));
          }
          
          // For objects, compare all keys regardless of order
          const keysA = Object.keys(a);
          const keysB = Object.keys(b);
          if (keysA.length !== keysB.length) return false;
          return keysA.every(key => deepEqual(a[key], b[key]));
        };

        const schemaLevelProps = ['timestamps', 'paranoid', 'usertrack', 'indexes'];
        for (const prop of schemaLevelProps) {
          if (schemaToStore[prop] !== undefined && !deepEqual(existingSchema[prop], schemaToStore[prop])) {
            existingSchema[prop] = schemaToStore[prop];
            hasChanges = true;
            console.log(`Updated ${prop} for ${schemaData.collectionName}`);
          }
        }

        // Log field differences
        if (newFields.length > 0) {
          console.log(`[SCHEMA DIFF] ${schemaData.collectionName} new fields:`, newFields);
        }

        if (hasChanges) {
          await db
            .update(baasixSchemaDefinition)
            .set({
              schema: existingSchema,
              updatedAt: new Date()
            } as any)
            .where(eq(baasixSchemaDefinition.collectionName, schemaData.collectionName));

          console.log(`Updated system schema: ${schemaData.collectionName}`);
          needUpdate.push(schemaData.collectionName);
        }
      }
    }

    console.log('System schemas ensured in SchemaDefinition table.');
    return needUpdate;
  }

  /**
   * Sort schemas by dependency order (topological sort)
   */
  private sortSchemasByDependencies(schemas: any[]): any[] {
    // Build dependency graph
    const dependencies = new Map<string, Set<string>>();
    const schemaMap = new Map<string, any>();

    for (const schemaDef of schemas) {
      const collectionName = schemaDef.collectionName;
      schemaMap.set(collectionName, schemaDef);
      dependencies.set(collectionName, new Set());

      // Find all BelongsTo relations (foreign key dependencies)
      const schema = schemaDef.schema as any;
      if (schema.fields) {
        for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
          const fs = fieldSchema as any;
          if (fs.relType === 'BelongsTo' && fs.target && fs.target !== collectionName) {
            dependencies.get(collectionName)!.add(fs.target);
          }
        }
      }
    }

    // Topological sort using Kahn's algorithm
    const sorted: any[] = [];
    const inDegree = new Map<string, number>();
    const queue: string[] = [];

    // Calculate in-degrees (number of dependencies for each table)
    for (const [node, deps] of dependencies) {
      inDegree.set(node, deps.size);
    }

    // Debug: Log dependencies
    console.log('Dependencies map:');
    for (const [node, deps] of dependencies) {
      if (deps.size > 0) {
        console.log(`  ${node} depends on: [${Array.from(deps).join(', ')}]`);
      }
    }

    // Find nodes with no dependencies (in-degree = 0)
    for (const [node, degree] of inDegree) {
      if (degree === 0) {
        queue.push(node);
      }
    }

    console.log('Starting with tables that have no dependencies:', queue.join(', '));

    // Process queue
    while (queue.length > 0) {
      const node = queue.shift()!;
      const schemaDef = schemaMap.get(node);
      if (schemaDef) {
        sorted.push(schemaDef);
      }

      // Reduce in-degree for nodes that depend on this one
      for (const [otherNode, deps] of dependencies) {
        if (deps.has(node)) {
          const newDegree = (inDegree.get(otherNode) || 0) - 1;
          inDegree.set(otherNode, newDegree);
          if (newDegree === 0) {
            queue.push(otherNode);
          }
        }
      }
    }

    // If sorted length != schemas length, there's a circular dependency
    // In that case, just return original order and let FK constraints be added later
    if (sorted.length !== schemas.length) {
      console.warn('Circular dependency detected in schemas, using original order');
      return schemas;
    }

    return sorted;
  }

  /**
   * Load and create tables for specific schemas
   */
  private async loadAndCreateAllSchemas(needSyncing: string[]): Promise<void> {
    const db = getDatabase();

    const schemas = await db
      .select()
      .from(baasixSchemaDefinition)
      .where(inArray(baasixSchemaDefinition.collectionName, needSyncing));

    // Sort schemas by dependency order to ensure referenced tables exist first
    const sortedSchemas = this.sortSchemasByDependencies(schemas);
    console.log('Schema creation order:', sortedSchemas.map(s => s.collectionName).join(', '));

    // First pass: Create all tables and models without FK constraints
    for (const schemaDef of sortedSchemas) {
      await this.createOrUpdateModel(
        schemaDef.collectionName,
        schemaDef.schema as any
      );

      // Create table using raw SQL (FK constraints will be added in second pass)
      await this.createTableFromSchema(schemaDef.collectionName, schemaDef.schema as any, true);
    }

    // Second pass: Add foreign key constraints
    console.log('Adding foreign key constraints...');
    for (const schemaDef of sortedSchemas) {
      await this.ensureForeignKeyConstraints(schemaDef.collectionName, schemaDef.schema as any);
    }

    console.log('All schemas loaded, models created/updated.');
  }

  /**
   * Normalize legacy Sequelize schemas - add default values for timestamp fields
   * and update DB column defaults if missing
   */
  private async normalizeLegacySchema(collectionName: string, schema: any): Promise<any> {
    const sql = getSqlClient();
    const db = getDatabase();
    let schemaUpdated = false;
    const normalizedSchema = { ...schema, fields: { ...schema.fields } };

    // Check timestamp fields if timestamps are enabled (default: true)
    if (schema.timestamps !== false) {
      // Normalize createdAt field
      if (normalizedSchema.fields.createdAt && !normalizedSchema.fields.createdAt.defaultValue) {
        normalizedSchema.fields.createdAt = {
          ...normalizedSchema.fields.createdAt,
          defaultValue: { type: "NOW" }
        };
        schemaUpdated = true;
        
        // Also update DB column default
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "createdAt" SET DEFAULT NOW()`);
          console.log(`Updated createdAt default value for ${collectionName}`);
        } catch (error) {
          // Column might not exist yet or already have default, ignore
        }
      }

      // Normalize updatedAt field
      if (normalizedSchema.fields.updatedAt && !normalizedSchema.fields.updatedAt.defaultValue) {
        normalizedSchema.fields.updatedAt = {
          ...normalizedSchema.fields.updatedAt,
          defaultValue: { type: "NOW" }
        };
        schemaUpdated = true;
        
        // Also update DB column default
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ALTER COLUMN "updatedAt" SET DEFAULT NOW()`);
          console.log(`Updated updatedAt default value for ${collectionName}`);
        } catch (error) {
          // Column might not exist yet or already have default, ignore
        }
      }
    }

    // Update schema definition in database if changed
    if (schemaUpdated) {
      await db
        .update(baasixSchemaDefinition)
        .set({ schema: normalizedSchema as any })
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
      console.log(`Normalized legacy schema definition for ${collectionName}`);
    }

    return normalizedSchema;
  }

  /**
   * Load all schemas from database into memory
   */
  private async loadAllSchemas(): Promise<void> {
    const db = getDatabase();

    const schemaDefinitions = await db
      .select()
      .from(baasixSchemaDefinition);

    console.log(`Found ${schemaDefinitions.length} schema definitions`);

    // Sort schemas by dependency order
    const sortedSchemas = this.sortSchemasByDependencies(schemaDefinitions);

    // First pass: Create all tables and models without FK constraints
    for (const schemaDef of sortedSchemas) {
      // Normalize legacy Sequelize schemas (add default values for timestamp fields)
      const normalizedSchema = await this.normalizeLegacySchema(
        schemaDef.collectionName,
        schemaDef.schema as any
      );
      
      // Update the schemaDef with normalized schema for subsequent operations
      schemaDef.schema = normalizedSchema;
      
      // Store JSON schema definition for later use (e.g., in getPrimaryKey)
      this.schemaDefinitions.set(schemaDef.collectionName, schemaDef);

      await this.createOrUpdateModel(
        schemaDef.collectionName,
        normalizedSchema
      );

      // Create table if it doesn't exist (FK constraints will be added in second pass)
      await this.createTableFromSchema(
        schemaDef.collectionName,
        normalizedSchema,
        true
      );
    }

    // Second pass: Add foreign key constraints
    console.log('Adding foreign key constraints...');
    for (const schemaDef of sortedSchemas) {
      await this.ensureForeignKeyConstraints(schemaDef.collectionName, schemaDef.schema as any);
    }

    // Check if we need to seed the database
    await this.checkAndSeedDatabase();
  }

  /**
   * Sync table columns with schema definition (add missing columns)
   */
  private async syncTableColumns(collectionName: string, schema: any): Promise<void> {
    const sql = getSqlClient();

    // Get existing columns in the table
    const existingColumns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = ${collectionName}
    `;

    const existingColumnNames = existingColumns.map((col: any) => col.column_name);

    // Check each field in schema
    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const fs = fieldSchema as any;

      // Skip relation fields that don't have an explicit type
      if (fs.relType && !fs.type) {
        // For BelongsTo relations, check if the foreign key column needs to be added
        if (fs.relType === 'BelongsTo') {
          const foreignKey = fs.foreignKey || `${fieldName}_Id`;
          if (!existingColumnNames.includes(foreignKey)) {
            // Column doesn't exist, add it via ensureForeignKeyConstraints
            continue;
          }
        }
        continue;
      }

      // Check if column exists
      if (!existingColumnNames.includes(fieldName)) {
        // Column is missing, add it
        const columnDef = this.buildColumnDefinition(fieldName, fs);
        if (columnDef) {
          // Extract just the type and constraints from columnDef (remove field name)
          const columnDefParts = columnDef.split(' ').slice(1).join(' '); // Remove first part which is field name
          try {
            // Use IF NOT EXISTS for safety in case of race conditions or schema query issues
            await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS ${columnDef}`);
            console.log(`Added missing column ${fieldName} to ${collectionName}`);
          } catch (error) {
            console.error(`Failed to add column ${fieldName} to ${collectionName}:`, error);
          }
        }
      }
    }

    // Add timestamp columns if needed
    if (schema.timestamps !== false) {
      if (!existingColumnNames.includes('createdAt')) {
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT NOW()`);
          console.log(`Added createdAt column to ${collectionName}`);
        } catch (error) {
          // Column might already exist due to race condition, ignore
        }
      }
      if (!existingColumnNames.includes('updatedAt')) {
        try {
          await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW()`);
          console.log(`Added updatedAt column to ${collectionName}`);
        } catch (error) {
          // Column might already exist due to race condition, ignore
        }
      }
    }

    // Add deletedAt column if paranoid mode is enabled
    if (schema.paranoid && !existingColumnNames.includes('deletedAt')) {
      try {
        await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ`);
        console.log(`Added deletedAt column to ${collectionName}`);
      } catch (error) {
        // Column might already exist due to race condition, ignore
      }
    }
  }

  /**
   * Create table from schema definition using raw SQL
   */
  private async createTableFromSchema(collectionName: string, schema: any, skipFKConstraints: boolean = false): Promise<void> {
    const sql = getSqlClient();

    // Check if table already exists
    const exists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${collectionName}
      )
    `;

    if (exists[0].exists) {
      console.log(`Table ${collectionName} already exists, syncing schema changes`);
      // Sync missing columns with existing table
      await this.syncTableColumns(collectionName, schema);

      // Check/add foreign key constraints
      if (!skipFKConstraints) {
        await this.ensureForeignKeyConstraints(collectionName, schema);
      }
      return;
    }

    // Build CREATE TABLE statement
    const columns: string[] = [];
    const foreignKeyAssociations: Array<{fieldName: string, assoc: any}> = [];

    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const fs = fieldSchema as any;

      // Handle BelongsTo relations - they need a foreign key column
      if (fs.relType === 'BelongsTo') {
        const foreignKey = fs.foreignKey || `${fieldName}_Id`;

        // Check if foreign key column already exists as a separate field
        // If foreignKey === fieldName AND field has explicit type, we'll create it below
        const foreignKeyExists = foreignKey !== fieldName && Object.keys(schema.fields).includes(foreignKey);

        if (!foreignKeyExists && foreignKey !== fieldName) {
          // Only create foreign key column if it doesn't already exist as a separate field
          const columnDef = this.buildColumnDefinition(foreignKey, {
            type: fs.type || 'UUID',
            allowNull: fs.allowNull,
            unique: fs.unique
          });
          if (columnDef) {
            columns.push(columnDef);
          }
        }

        // Store association for later foreign key constraint creation
        foreignKeyAssociations.push({fieldName, assoc: fs});

        // If foreignKey === fieldName AND field has explicit type, don't skip - create column below
        if (foreignKey === fieldName && fs.type) {
          // Fall through to create the column
        } else {
          continue;
        }
      }

      // Skip other relation types that don't have explicit type
      if (fs.relType && !fs.type) continue;

      const columnDef = this.buildColumnDefinition(fieldName, fs);
      if (columnDef) {
        columns.push(columnDef);
      }
    }

    // Add timestamps if enabled (default: true unless explicitly set to false)
    if (schema.timestamps !== false) {
      if (!schema.fields.createdAt) {
        columns.push('"createdAt" TIMESTAMPTZ DEFAULT NOW()');
      }
      if (!schema.fields.updatedAt) {
        columns.push('"updatedAt" TIMESTAMPTZ DEFAULT NOW()');
      }
    }

    // Add deletedAt for paranoid mode
    if (schema.paranoid) {
      if (!schema.fields.deletedAt) {
        columns.push('"deletedAt" TIMESTAMPTZ');
      }
    }

    if (columns.length === 0) {
      console.warn(`No columns to create for table ${collectionName}`);
      return;
    }

    const createTableSQL = `CREATE TABLE "${collectionName}" (${columns.join(', ')})`;

    try {
      await sql.unsafe(createTableSQL);
      console.log(`Created table: ${collectionName}`);

      // Create foreign key constraints for BelongsTo relations (unless skipped)
      if (!skipFKConstraints && foreignKeyAssociations.length > 0) {
        await this.ensureForeignKeyConstraints(collectionName, schema);
      }

      // Create indexes if defined in schema
      if (schema.indexes && Array.isArray(schema.indexes)) {
        for (const index of schema.indexes) {
          await this.createIndex(collectionName, index);
        }
      }
    } catch (error) {
      console.error(`Failed to create table ${collectionName}:`, error);
    }
  }

  /**
   * Ensure foreign key constraints exist for BelongsTo relations
   */
  private async ensureForeignKeyConstraints(collectionName: string, schema: any): Promise<void> {
    const sql = getSqlClient();

    // Extract BelongsTo relations from schema fields
    const belongsToRelations: Array<{fieldName: string, assoc: any}> = [];
    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const fs = fieldSchema as any;
      if (fs.relType === 'BelongsTo') {
        belongsToRelations.push({fieldName, assoc: fs});
      }
    }

    if (belongsToRelations.length === 0) {
      return; // No BelongsTo relations
    }

    // Track if any columns were added
    let columnsAdded = false;

    // Process each BelongsTo relation
    for (const {fieldName, assoc} of belongsToRelations) {
      // Skip if constraints are explicitly disabled (for polymorphic relations)
      if (assoc.constraints === false) {
        console.log(`Skipping FK constraint for ${fieldName} (constraints: false)`);
        continue;
      }

      const foreignKey = assoc.foreignKey || `${fieldName}_Id`;
      const targetTable = assoc.target;
      const targetKey = assoc.targetKey || 'id';
      const onDelete = (assoc.onDelete || 'CASCADE').toUpperCase();
      const onUpdate = (assoc.onUpdate || 'CASCADE').toUpperCase();
      const constraintName = `fk_${collectionName}_${foreignKey}`;

      try {
        // First, check if the foreign key column exists
        const columnExists = await sql`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = ${collectionName}
            AND column_name = ${foreignKey}
        `;

        if (columnExists.length === 0) {
          // Column doesn't exist, add it
          console.log(`Adding foreign key column ${foreignKey} to ${collectionName}`);
          // Get the type from the foreign key field definition, not the relation definition
          const columnType = schema.fields[foreignKey]?.type || assoc.type || 'UUID';
          const pgType = columnType === 'UUID' ? 'UUID' :
                        columnType === 'Integer' ? 'INTEGER' :
                        columnType === 'String' ? 'TEXT' : 'UUID';

          // Use IF NOT EXISTS for safety
          await sql.unsafe(`ALTER TABLE "${collectionName}" ADD COLUMN IF NOT EXISTS "${foreignKey}" ${pgType}`);
          console.log(`Added column ${foreignKey} to ${collectionName}`);
          columnsAdded = true;

          // Update schema definition to include the new field
          if (!schema.fields[foreignKey]) {
            schema.fields[foreignKey] = {
              type: columnType,
              allowNull: true,
              SystemGenerated: true
            };
          }
        }

        // Check if constraint already exists
        const existingConstraint = await sql`
          SELECT
            tc.constraint_name,
            rc.delete_rule,
            rc.update_rule
          FROM information_schema.table_constraints tc
          JOIN information_schema.referential_constraints rc
            ON tc.constraint_name = rc.constraint_name
          WHERE tc.table_name = ${collectionName}
            AND tc.constraint_type = 'FOREIGN KEY'
            AND tc.constraint_name = ${constraintName}
        `;

        // If constraint exists, check if onDelete/onUpdate actions match
        if (existingConstraint.length > 0) {
          const existing = existingConstraint[0];
          const existingOnDelete = existing.delete_rule.replace(' ', '_').toUpperCase();
          const existingOnUpdate = existing.update_rule.replace(' ', '_').toUpperCase();

          if (existingOnDelete === onDelete && existingOnUpdate === onUpdate) {
            console.log(`Foreign key constraint ${constraintName} already exists with correct actions`);
            continue; // Constraint is correct, skip
          }

          // Drop the old constraint if actions don't match
          console.log(`Dropping foreign key constraint ${constraintName} to update actions`);
          await sql.unsafe(`ALTER TABLE "${collectionName}" DROP CONSTRAINT "${constraintName}"`);
        }

        // Create the foreign key constraint
        const fkSQL = createForeignKeySQL(
          collectionName,
          foreignKey,
          targetTable,
          targetKey,
          onDelete,
          onUpdate
        );

        await sql.unsafe(fkSQL);
        console.log(`Created foreign key constraint: ${constraintName}`);
      } catch (error) {
        console.error(`Failed to create foreign key constraint ${constraintName}:`, error);
        // Don't throw - allow table creation to continue even if FK constraint fails
      }
    }

    // If columns were added, regenerate the Drizzle schema to include them
    if (columnsAdded) {
      console.log(`Regenerating Drizzle schema for ${collectionName} to include new foreign key columns`);
      console.log(`Fields in schema:`, Object.keys(schema.fields));

      // Update schemaDefinitions Map with the modified schema
      const schemaDef = this.schemaDefinitions.get(collectionName);
      if (schemaDef) {
        schemaDef.schema = schema;
        this.schemaDefinitions.set(collectionName, schemaDef);
      }

      // Update the schema in the database table
      const db = getDatabase();
      await db
        .update(baasixSchemaDefinition)
        .set({ schema: schema })
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
      console.log(`Updated schema definition in database for ${collectionName}`);

      // Regenerate the Drizzle table schema
      await this.createOrUpdateModel(collectionName, schema);
      const updatedSchema = this.schemas.get(collectionName);
      console.log(`After regeneration, ${collectionName} table has columns:`, Object.keys(updatedSchema || {}).filter(k => !k.startsWith('_')));
      console.log(`Drizzle schema for ${collectionName} regenerated successfully`);
    }
  }

  /**
   * Create an index on a table
   */
  private async createIndex(tableName: string, indexDef: any): Promise<void> {
    const sql = getSqlClient();
    
    try {
      const fields = indexDef.fields.map((f: string) => `"${f}"`).join(', ');
      const indexName = indexDef.name || `${tableName}_${indexDef.fields.join('_')}_idx`;
      const unique = indexDef.unique ? 'UNIQUE' : '';
      // Support NULLS NOT DISTINCT for unique indexes (PostgreSQL 15+)
      let nullsNotDistinct = '';
      if (indexDef.unique && indexDef.nullsNotDistinct) {
        const supportsNullsNotDistinct = await isPgVersionAtLeast(15);
        if (supportsNullsNotDistinct) {
          nullsNotDistinct = ' NULLS NOT DISTINCT';
        } else {
          console.warn(`Index ${indexName}: NULLS NOT DISTINCT requires PostgreSQL 15+, ignoring option`);
        }
      }
      
      const createIndexSQL = `CREATE ${unique} INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${fields})${nullsNotDistinct}`;
      
      await sql.unsafe(createIndexSQL);
      console.log(`Created index: ${indexName} on ${tableName}`);
    } catch (error) {
      console.error(`Failed to create index on ${tableName}:`, error);
    }
  }

  /**
   * Build column definition for CREATE TABLE
   */
  private buildColumnDefinition(fieldName: string, fieldSchema: any): string | null {
    const parts: string[] = [`"${fieldName}"`];
    
    // Handle VIRTUAL (computed) fields - these are GENERATED columns
    if (fieldSchema.type === 'VIRTUAL') {
      if (fieldSchema.calculated) {
        // VIRTUAL fields are GENERATED ALWAYS AS ... STORED
        parts.push('TEXT'); // Default to TEXT for computed fields
        parts.push(`GENERATED ALWAYS AS (${fieldSchema.calculated}) STORED`);
        return parts.join(' ');
      } else {
        console.warn(`VIRTUAL field "${fieldName}" has no calculated expression. Skipping.`);
        return null;
      }
    }
    
    // Check for AUTOINCREMENT first
    const hasAutoIncrement = fieldSchema.defaultValue?.type === 'AUTOINCREMENT';
    
    // Map type
    let pgType = 'TEXT';
    switch (fieldSchema.type) {
      case 'UUID':
        pgType = 'UUID';
        break;
      case 'String':
        pgType = fieldSchema.values?.stringLength ? `VARCHAR(${fieldSchema.values.stringLength})` : 'TEXT';
        break;
      case 'Text':
        pgType = 'TEXT';
        break;
      case 'HTML':
        // HTML content - stored as TEXT in database
        pgType = 'TEXT';
        break;
      case 'Integer':
        // Use SERIAL for auto-increment integers
        pgType = hasAutoIncrement ? 'SERIAL' : 'INTEGER';
        break;
      case 'BigInt':
        // Use BIGSERIAL for auto-increment bigints
        pgType = hasAutoIncrement ? 'BIGSERIAL' : 'BIGINT';
        break;
      case 'Boolean':
        pgType = 'BOOLEAN';
        break;
      case 'DateTime':
        pgType = 'TIMESTAMPTZ';
        break;
      case 'DateTime_NO_TZ':
        pgType = 'TIMESTAMP';
        break;
      case 'Date':
        pgType = 'DATE';
        break;
      case 'Time':
        pgType = 'TIMETZ';
        break;
      case 'Time_NO_TZ':
        pgType = 'TIME';
        break;
      case 'JSON':
      case 'JSONB':
        pgType = 'JSONB';
        break;
      case 'Decimal':
      case 'Real':
      case 'Double':
        pgType = 'NUMERIC';
        break;
      
      // PostGIS Geometry types
      case 'Point':
        pgType = `geometry(Point, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'LineString':
        pgType = `geometry(LineString, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'Polygon':
        pgType = `geometry(Polygon, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'MultiPoint':
        pgType = `geometry(MultiPoint, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'MultiLineString':
        pgType = `geometry(MultiLineString, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'MultiPolygon':
        pgType = `geometry(MultiPolygon, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'GeometryCollection':
        pgType = `geometry(GeometryCollection, ${fieldSchema.values?.srid || 4326})`;
        break;
      case 'Geography':
        pgType = `geography(Point, ${fieldSchema.values?.srid || 4326})`;
        break;
    }
    
    parts.push(pgType);
    
    // Primary key
    if (fieldSchema.primaryKey) {
      parts.push('PRIMARY KEY');
    }
    
    // Not null
    if (fieldSchema.allowNull === false) {
      parts.push('NOT NULL');
    }
    
    // Unique
    if (fieldSchema.unique) {
      parts.push('UNIQUE');
    }
    
    // Default value (skip if AUTOINCREMENT as SERIAL handles it)
    if (fieldSchema.defaultValue !== undefined && !hasAutoIncrement) {
      if (typeof fieldSchema.defaultValue === 'object' && fieldSchema.defaultValue.type) {
        switch (fieldSchema.defaultValue.type) {
          case 'UUIDV4':
            parts.push('DEFAULT gen_random_uuid()');
            break;
          case 'SUID':
            // Short unique ID - uses gen_random_uuid() for now
            parts.push('DEFAULT gen_random_uuid()');
            break;
          case 'NOW':
            parts.push('DEFAULT NOW()');
            break;
          case 'SQL':
            // Raw SQL default expression
            if (fieldSchema.defaultValue.value) {
              parts.push(`DEFAULT ${fieldSchema.defaultValue.value}`);
            }
            break;
        }
      } else if (typeof fieldSchema.defaultValue === 'string') {
        parts.push(`DEFAULT '${fieldSchema.defaultValue}'`);
      } else if (typeof fieldSchema.defaultValue === 'number') {
        parts.push(`DEFAULT ${fieldSchema.defaultValue}`);
      } else if (typeof fieldSchema.defaultValue === 'boolean') {
        parts.push(`DEFAULT ${fieldSchema.defaultValue}`);
      }
    }
    
    return parts.join(' ');
  }

  /**
   * Check if database is empty and seed if needed
   */
  private async checkAndSeedDatabase(): Promise<void> {
    // Check if we have the necessary tables
    const userSchema = this.schemas.get('baasix_User');
    const roleSchema = this.schemas.get('baasix_Role');
    
    if (!userSchema || !roleSchema) {
      return;
    }

    const sql = getSqlClient();
    
    // Count users and roles
    const userCount = await sql`SELECT COUNT(*) FROM "baasix_User"`;
    const roleCount = await sql`SELECT COUNT(*) FROM "baasix_Role"`;
    
    if (parseInt(userCount[0].count) === 0 && parseInt(roleCount[0].count) === 0) {
      console.log('Database is empty, seeding...');
      await this.seedDatabase();
    }
  }

  /**
   * Seed the database with initial data
   */
  private async seedDatabase(): Promise<void> {
    const sql = getSqlClient();
    
    try {
      console.log('Starting seeding...');

      // Create default roles
      await sql`
        INSERT INTO "baasix_Role" (id, name, description, "isTenantSpecific")
        VALUES 
          (gen_random_uuid(), 'administrator', 'Full system access', false),
          (gen_random_uuid(), 'user', 'Standard user access', true),
          (gen_random_uuid(), 'public', 'Public access (unauthenticated)', true)
        ON CONFLICT (name) DO NOTHING
      `;

      console.log('Default roles created');

      // Get admin role ID
      const adminRole = await sql`
        SELECT id FROM "baasix_Role" WHERE name = 'administrator' LIMIT 1
      `;

      if (adminRole.length > 0) {
        const adminRoleId = adminRole[0].id;

        // Hash the admin password
        const hashedPassword = await argon2.hash('admin@123');

        // Create default admin user
        const adminUserId = await sql`
          INSERT INTO "baasix_User" (id, email, "firstName", "lastName", password)
          VALUES (gen_random_uuid(), 'admin@baasix.com', 'Baasix', 'Admin', ${hashedPassword})
          ON CONFLICT (email) DO NOTHING
          RETURNING id
        `;

        if (adminUserId.length > 0) {
          // Assign admin role to admin user
          await sql`
            INSERT INTO "baasix_UserRole" (id, "user_Id", "role_Id", "tenant_Id")
            VALUES (gen_random_uuid(), ${adminUserId[0].id}, ${adminRoleId}, NULL)
            ON CONFLICT DO NOTHING
          `;
        }

        console.log('Default admin user created');
      }

      // Seed default email templates
      await this.seedDefaultTemplates();

      console.log('Seeding complete');
    } catch (error) {
      console.error('Error seeding database:', error);
    }
  }

  /**
   * Seed default email templates into baasix_Template table
   */
  private async seedDefaultTemplates(): Promise<void> {
    const sql = getSqlClient();

    // Check if templates table exists
    const templateTableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'baasix_Template'
      )
    `;

    if (!templateTableExists[0].exists) {
      console.log('baasix_Template table does not exist yet, skipping template seeding');
      return;
    }

    const defaultTemplates = [
      {
        type: 'inviteNewUser',
        subject: "You've been invited to join {{ tenant }}",
        body: `<h2>Welcome!</h2>
<p>Hi,</p>
<p>You've been invited by <strong>{{ inviterName }}</strong> to join <strong>{{ tenant }}</strong>.</p>
<p>Click the button below to accept your invitation and create your account:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ inviteLink }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a>
</p>
<p><strong>Note:</strong> This invitation will expire on {{ expirationDate }}.</p>
<p>If you didn't expect this invitation, you can safely ignore this email.</p>`,
        description: 'Template for inviting new users who do not have an account yet'
      },
      {
        type: 'inviteExistingUser',
        subject: "You've been invited to join {{ tenant }}",
        body: `<h2>New Invitation</h2>
<p>Hi,</p>
<p>You've been invited by <strong>{{ inviterName }}</strong> to join <strong>{{ tenant }}</strong>.</p>
<p>Since you already have an account, click the button below to accept the invitation:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ inviteLink }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a>
</p>
<p><strong>Note:</strong> This invitation will expire on {{ expirationDate }}.</p>
<p>If you didn't expect this invitation, you can safely ignore this email.</p>`,
        description: 'Template for inviting existing users to a new tenant'
      },
      {
        type: 'magicLinkUrl',
        subject: 'Sign in to {{ project_name }}',
        body: `<h2>Sign In Request</h2>
<p>Hi {{ name }},</p>
<p>Click the button below to sign in to your account:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ magicLinkUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Sign In</a>
</p>
<p>This link will expire in 15 minutes for security purposes.</p>
<p>If you didn't request this sign-in link, you can safely ignore this email.</p>`,
        description: 'Template for magic link URL authentication'
      },
      {
        type: 'magicLinkCode',
        subject: 'Your sign in code for {{ project_name }}',
        body: `<h2>Sign In Code</h2>
<p>Hi {{ name }},</p>
<p>Use the following code to sign in to your account:</p>
<p style="text-align: center; margin: 30px 0;">
  <span style="background-color: #f5f5f5; padding: 16px 32px; font-size: 24px; font-family: monospace; letter-spacing: 4px; border-radius: 4px; display: inline-block;">{{ code }}</span>
</p>
<p>This code will expire in 15 minutes for security purposes.</p>
<p>If you didn't request this code, you can safely ignore this email.</p>`,
        description: 'Template for magic link code authentication'
      },
      {
        type: 'passwordReset',
        subject: 'Reset your password for {{ project_name }}',
        body: `<h2>Password Reset</h2>
<p>Hi {{ name }},</p>
<p>We received a request to reset your password. Click the button below to choose a new password:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ resetUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Reset Password</a>
</p>
<p>This link will expire in 1 hour for security purposes.</p>
<p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>`,
        description: 'Template for password reset emails'
      },
      {
        type: 'emailVerification',
        subject: 'Verify your email for {{ project_name }}',
        body: `<h2>Email Verification</h2>
<p>Hi {{ name }},</p>
<p>Please verify your email address by clicking the button below:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ verifyUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Verify Email</a>
</p>
<p>This link will expire in 24 hours.</p>
<p>If you didn't create an account, you can safely ignore this email.</p>`,
        description: 'Template for email verification'
      },
      {
        type: 'welcome',
        subject: 'Welcome to {{ project_name }}!',
        body: `<h2>Welcome!</h2>
<p>Hi {{ name }},</p>
<p>Thank you for joining {{ project_name }}! We're excited to have you on board.</p>
<p>Your account has been successfully created and you're ready to get started.</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ loginUrl }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Get Started</a>
</p>
<p>If you have any questions, feel free to reach out to our support team.</p>`,
        description: 'Template for welcome emails to new users'
      },
      {
        type: 'notification',
        subject: '{{ notification_title }}',
        body: `<h2>{{ notification_title }}</h2>
<p>Hi {{ name }},</p>
<div>{{ notification_message }}</div>
{% if action_url %}
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ action_url }}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">{{ action_text | default: 'View Details' }}</a>
</p>
{% endif %}`,
        description: 'Generic notification template'
      }
    ];

    try {
      for (const template of defaultTemplates) {
        await sql`
          INSERT INTO "baasix_Template" (id, type, subject, body, "tenant_Id", "isActive", description)
          VALUES (gen_random_uuid(), ${template.type}, ${template.subject}, ${template.body}, NULL, true, ${template.description})
          ON CONFLICT ("tenant_Id", type) DO NOTHING
        `;
      }
      console.log('Default email templates created');
    } catch (error) {
      console.error('Error seeding default templates:', error);
    }
  }

  /**
   * Ensure baasix_SchemaDefinition table exists
   */
  private async ensureSchemaDefinitionTableOLD(): Promise<void> {
    const sql = getSqlClient();
    
    // Check if table exists
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'baasix_SchemaDefinition'
      )
    `;

    if (!result[0].exists) {
      console.log('Creating baasix_SchemaDefinition table...');
      
      await sql`
        CREATE TABLE "baasix_SchemaDefinition" (
          id SERIAL PRIMARY KEY,
          "collectionName" TEXT NOT NULL UNIQUE,
          schema JSONB NOT NULL,
          active BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "deletedAt" TIMESTAMPTZ
        )
      `;
    }
  }

  /**
   * Create or update a model from JSON schema definition
   */
  async createOrUpdateModel(
    collectionName: string,
    jsonSchema: SchemaDefinition['schema']
  ): Promise<any> {
    try {
      console.log(`Creating/updating model: ${collectionName}`);

      let { fields, options, associations } = jsonSchema;

      // Add tenant fields for non-system schemas in multi-tenant mode
      const isSystemSchema = collectionName.startsWith('baasix_');
      const envValue = env.get('MULTI_TENANT');
      const isMultiTenant = envValue === 'true';

      console.log(`[createOrUpdateModel] ${collectionName}:`, {
        isSystemSchema,
        envValue: `"${envValue}"`,
        isMultiTenant,
        willAddTenantFields: isMultiTenant && !isSystemSchema
      });

      if (isMultiTenant && !isSystemSchema) {
        console.log(`[createOrUpdateModel] Adding tenant fields to ${collectionName}`);
        // Add tenant_Id field and tenant relation for multi-tenant isolation
        // IMPORTANT: Modify jsonSchema.fields directly so changes are reflected in createTableFromSchema
        jsonSchema.fields = {
          ...fields,
          tenant_Id: {
            type: 'UUID',
            allowNull: true,
            SystemGenerated: 'true',
            description: 'Tenant identifier for multi-tenant isolation'
          },
          tenant: {
            relType: 'BelongsTo',
            target: 'baasix_Tenant',
            foreignKey: 'tenant_Id',
            as: 'tenant',
            SystemGenerated: 'true',
            description: 'M2O relationship to tenant'
          }
        };

        // Update local fields variable to match
        fields = jsonSchema.fields;

        // Add tenant_Id to unique indexes for proper multi-tenant isolation
        if (!options) {
          options = {};
          jsonSchema.options = options;
        }
        if (!options.indexes) {
          options.indexes = [];
        }

        options.indexes = options.indexes.map((index: any) => {
          if (index.unique && !index.fields.includes('tenant_Id')) {
            return {
              ...index,
              fields: [...index.fields, 'tenant_Id']
            };
          }
          return index;
        });

        // Update jsonSchema.options to reflect index changes
        jsonSchema.options = options;
      }

      // Extract associations from fields if not provided separately
      // This maintains compatibility with Sequelize-style schemas where relations are in fields
      if (!associations) {
        associations = {};
        console.log(`[createOrUpdateModel] Extracting associations for ${collectionName} from fields:`, Object.keys(fields));
        for (const [fieldName, fieldSchema] of Object.entries(fields)) {
          if (isRelationField(fieldSchema)) {
            const relSchema = fieldSchema as any;
            console.log(`[createOrUpdateModel] Found relation field ${fieldName}:`, { relType: relSchema.relType, target: relSchema.target, polymorphic: relSchema.polymorphic });
            // Use the 'as' name as the key if provided, otherwise use fieldName
            // This allows relations to be accessed by their alias (e.g., 'category' instead of 'categoryId')
            const relationKey = relSchema.as || fieldName;
            associations[relationKey] = {
              type: relSchema.relType,
              model: relSchema.target,
              foreignKey: relSchema.foreignKey,
              targetKey: relSchema.targetKey,
              as: relSchema.as || fieldName,
              // For M2A (polymorphic), target IS the junction table
              // For BelongsToMany, through is explicitly set
              through: relSchema.through || (relSchema.polymorphic ? relSchema.target : undefined),
              onDelete: relSchema.onDelete,
              onUpdate: relSchema.onUpdate,
              // M2A/polymorphic specific fields
              polymorphic: relSchema.polymorphic,
              tables: relSchema.tables
            } as any;
          }
        }
        console.log(`[createOrUpdateModel] Extracted ${Object.keys(associations).length} associations for ${collectionName}:`, Object.keys(associations));
      }

      // Build column definitions
      const columns: Record<string, any> = {};

      console.log(`[createOrUpdateModel] ${collectionName} field names after tenant injection:`, Object.keys(fields));

      // Process each field
      for (const [fieldName, fieldSchema] of Object.entries(fields)) {
        // Skip relationship-only fields (no explicit type defined)
        // But process fields that have both type AND relType (e.g., foreign key columns)
        if (isRelationField(fieldSchema) && !fieldSchema.type) {
          continue;
        }

        try {
          const column = mapJsonTypeToDrizzle(fieldName, fieldSchema);
          if (column) {
            columns[fieldName] = column;
          }
        } catch (error) {
          console.warn(`Failed to map field ${fieldName}:`, error);
        }
      }

      // Add timestamps if enabled (default: true)
      const includeTimestamps = options?.timestamps !== false;
      if (includeTimestamps) {
        if (!columns.createdAt) {
          columns.createdAt = timestamp('createdAt', { withTimezone: true }).notNull().defaultNow();
        }
        if (!columns.updatedAt) {
          columns.updatedAt = timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow();
        }
      }

      // Add deletedAt for paranoid mode
      if (options?.paranoid) {
        if (!columns.deletedAt) {
          columns.deletedAt = timestamp('deletedAt', { withTimezone: true });
        }
      }

      // Create the table schema
      const tableSchema = pgTable(collectionName, columns);

      // Store the schema (soft-delete filtering will be applied at query time)
      this.schemas.set(collectionName, tableSchema);
      
      // Track paranoid mode for this table
      if (options?.paranoid) {
        this.schemas.set(`${collectionName}_paranoid`, true);
      }

      // Handle associations (store them for later query use)
      if (associations) {
        relationBuilder.storeAssociations(collectionName, associations);
      }

      // Create indexes if specified
      if (options?.indexes && options.indexes.length > 0) {
        await this.createIndexes(collectionName, options.indexes);
      }

      // Register hooks if needed
      this.registerModelHooks(collectionName, jsonSchema);

      console.log(`Model ${collectionName} created successfully`);
      return tableSchema;
    } catch (error) {
      console.error(`Failed to create/update model ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Create indexes for a table
   */
  private async createIndexes(
    tableName: string,
    indexes: Array<{
      name?: string;
      fields: string[];
      unique?: boolean;
      nullsNotDistinct?: boolean;
      type?: 'BTREE' | 'HASH' | 'GIST' | 'GIN' | 'FULLTEXT';
    }>
  ): Promise<void> {
    const sql = getSqlClient();
    // Check PostgreSQL version once for all indexes
    const supportsNullsNotDistinct = await isPgVersionAtLeast(15);

    for (const index of indexes) {
      try {
        const indexName = index.name || `${tableName}_${index.fields.join('_')}_idx`;
        const unique = index.unique ? 'UNIQUE' : '';
        const method = index.type || 'BTREE';
        const fields = index.fields.map(f => `"${f}"`).join(', ');
        // Support NULLS NOT DISTINCT for unique indexes (PostgreSQL 15+)
        let nullsNotDistinct = '';
        if (index.unique && index.nullsNotDistinct) {
          if (supportsNullsNotDistinct) {
            nullsNotDistinct = ' NULLS NOT DISTINCT';
          } else {
            console.warn(`Index ${indexName}: NULLS NOT DISTINCT requires PostgreSQL 15+, ignoring option`);
          }
        }

        // Check if index already exists
        const exists = await sql`
          SELECT EXISTS (
            SELECT FROM pg_indexes 
            WHERE tablename = ${tableName} 
            AND indexname = ${indexName}
          )
        `;

        if (!exists[0].exists) {
          await sql.unsafe(`
            CREATE ${unique} INDEX "${indexName}"
            ON "${tableName}" USING ${method} (${fields})${nullsNotDistinct}
          `);
          console.log(`Created index ${indexName} on ${tableName}`);
        }
      } catch (error) {
        console.warn(`Failed to create index on ${tableName}:`, error);
      }
    }
  }

  /**
   * Register model-specific hooks
   */
  private registerModelHooks(
    collectionName: string,
    jsonSchema: SchemaDefinition['schema']
  ): void {
    // Hook registration will be implemented based on schema configuration
    // For now, this is a placeholder for future hook registration
    // const hooksManager = HooksManager.getInstance();
    
    // Example: Register audit logging hook for all models
    // This can be customized based on schema options
    if (jsonSchema.options?.paranoid) {
      // Add soft-delete specific hooks if needed
    }
  }

  /**
   * Get a registered schema by collection name
   */
  getSchema(collectionName: string): any {
    return this.schemas.get(collectionName);
  }

  /**
   * Get all registered schemas
   */
  getAllSchemas(): Map<string, any> {
    return this.schemas;
  }

  /**
   * Check if a model/collection exists
   */
  modelExists(collectionName: string): boolean {
    return this.schemas.has(collectionName);
  }

  /**
   * Get table for a collection
   */
  getTable(collectionName: string): any {
    const schema = this.schemas.get(collectionName);
    if (!schema) {
      throw new Error(`Table not found for collection: ${collectionName}`);
    }
    return schema;
  }

  /**
   * Get primary key field name for a collection
   */
  getPrimaryKey(collectionName: string): string {
    // Get schema definition from schemaDefinitions Map (loaded during initialization)
    const schemaDef = this.schemaDefinitions.get(collectionName);

    if (schemaDef && schemaDef.schema && schemaDef.schema.fields) {
      // Find the field with primaryKey: true
      for (const [fieldName, fieldSchema] of Object.entries(schemaDef.schema.fields)) {
        if ((fieldSchema as any).primaryKey === true) {
          return fieldName;
        }
      }
    }

    // Default to 'id' if no primary key is explicitly defined
    return 'id';
  }

  /**
   * Check if a collection has paranoid mode enabled (soft delete)
   */
  isParanoid(collectionName: string): boolean {
    return this.schemas.get(`${collectionName}_paranoid`) === true;
  }

  /**
   * Get schema options for a collection
   */
  getSchemaOptions(collectionName: string): any {
    const schema = this.getSchema(collectionName);
    if (!schema) return {};

    // Schema options are stored in the schema definition
    // For now, we track paranoid mode separately
    return {
      paranoid: this.isParanoid(collectionName)
    };
  }

  /**
   * Get schema definition with flags from baasix_SchemaDefinition table
   */
  async getSchemaDefinition(collectionName: string): Promise<any | null> {
    try {
      const schemaDefTable = this.getTable('baasix_SchemaDefinition');
      if (!schemaDefTable) return null;

      const db = getDatabase();
      const result = await db
        .select()
        .from(schemaDefTable)
        .where(eq(schemaDefTable.collectionName, collectionName))
        .limit(1);

      if (result.length === 0) return null;

      return result[0].schema;
    } catch (error) {
      console.error(`Error getting schema definition for ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Get relation names for a collection
   */
  getRelationNames(collectionName: string): string[] {
    const associations = relationBuilder.getAssociations(collectionName);
    if (!associations) return [];
    return Object.keys(associations);
  }

  /**
   * Get relations for a collection
   */
  getRelations(collectionName: string): any {
    return this.relations.get(collectionName);
  }

  /**
   * Get a specific relation for a collection
   */
  getRelation(collectionName: string, relationName: string): any {
    const relations = this.relations.get(collectionName);
    return relations?.[relationName];
  }

  /**
   * Check if schema manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Add a new schema definition to the database
   */
  async addSchemaDefinition(
    collectionName: string,
    schema: SchemaDefinition['schema']
  ): Promise<void> {
    const db = getDatabase();
    
    // Check if schema already exists
    const existing = await db
      .select()
      .from(baasixSchemaDefinition)
      .where(eq(baasixSchemaDefinition.collectionName, collectionName))
      .limit(1);

    if (existing.length > 0) {
      // Update existing schema
      await db
        .update(baasixSchemaDefinition)
        .set({
          schema: schema as any,
          updatedAt: new Date(),
        } as any)
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
    } else {
      // Insert new schema
      await db.insert(baasixSchemaDefinition).values({
        collectionName,
        schema: schema as any,
      });
    }

    // Reload the schema
    await this.createOrUpdateModel(collectionName, schema);
  }

  /**
   * Remove a schema definition
   */
  async removeSchemaDefinition(collectionName: string): Promise<void> {
    const db = getDatabase();
    
    // Delete the schema definition
    await db
      .delete(baasixSchemaDefinition)
      .where(eq(baasixSchemaDefinition.collectionName, collectionName));

    // Remove from memory
    this.schemas.delete(collectionName);
    this.relations.delete(collectionName);
  }

  /**
   * Sync schemas - create/update tables in database
   * Similar to Sequelize.sync()
   */
  async sync(options?: { force?: boolean; alter?: boolean }): Promise<void> {
    console.log('Syncing schemas with database...');

    // For now, we rely on Drizzle Kit for migrations
    // In production, use: drizzle-kit push:pg or drizzle-kit migrate
    console.warn(
      'Schema sync is handled by Drizzle Kit. Run: npm run db:push'
    );
  }

  /**
   * Create or update a model (for schema routes compatibility)
   */
  async updateModel(collectionName: string, schema: any, accountability?: any): Promise<void> {
    console.log(`Creating/updating model: ${collectionName}`);
    console.log(`[updateModel] Schema fields for ${collectionName}:`, Object.keys(schema.fields || {}));

    // Store JSON schema definition in memory
    this.schemaDefinitions.set(collectionName, { collectionName, schema });

    // Update schema definition in database
    const db = getDatabase();
    const existingSchema = await db
      .select()
      .from(baasixSchemaDefinition)
      .where(eq(baasixSchemaDefinition.collectionName, collectionName))
      .limit(1);

    if (existingSchema.length > 0) {
      // Update existing schema
      await db
        .update(baasixSchemaDefinition)
        .set({ schema: schema as any, updatedAt: new Date() } as any)
        .where(eq(baasixSchemaDefinition.collectionName, collectionName));
      console.log(`Updated schema definition in database for ${collectionName}`);
    } else {
      // Insert new schema
      await db.insert(baasixSchemaDefinition).values({
        collectionName,
        schema: schema as any,
      });
      console.log(`Inserted new schema definition in database for ${collectionName}`);
    }

    // Create/update the Drizzle schema in memory
    await this.createOrUpdateModel(collectionName, schema);

    // Create the actual PostgreSQL table
    await this.createTableFromSchema(collectionName, schema);

    console.log(`Model ${collectionName} created/updated successfully`);
  }

  /**
   * Delete a model (for schema routes compatibility)
   */
  async deleteModel(collectionName: string): Promise<void> {
    console.log(`Deleting model: ${collectionName}`);
    this.schemas.delete(collectionName);
    // In production, this would drop the table
  }

  /**
   * Add an index to a collection
   */
  async addIndex(collectionName: string, indexData: any, accountability?: any): Promise<void> {
    const sql = getSqlClient();

    try {
      const fields = indexData.fields;
      const indexName = indexData.name || `${collectionName}_${fields.join('_')}_idx`;
      const unique = indexData.unique ? 'UNIQUE' : '';
      // Support NULLS NOT DISTINCT for unique indexes (PostgreSQL 15+)
      let nullsNotDistinct = '';
      if (indexData.unique && indexData.nullsNotDistinct) {
        const supportsNullsNotDistinct = await isPgVersionAtLeast(15);
        if (supportsNullsNotDistinct) {
          nullsNotDistinct = ' NULLS NOT DISTINCT';
        } else {
          console.warn(`Index ${indexName}: NULLS NOT DISTINCT requires PostgreSQL 15+, ignoring option`);
        }
      }

      // Check if table exists
      const tableExists = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = ${collectionName}
        )
      `;

      if (!tableExists[0].exists) {
        throw new Error(`Table ${collectionName} does not exist`);
      }

      // Check if index already exists
      const indexExists = await sql`
        SELECT EXISTS (
          SELECT FROM pg_indexes
          WHERE tablename = ${collectionName}
          AND indexname = ${indexName}
        )
      `;

      if (indexExists[0].exists) {
        console.log(`Index ${indexName} already exists on ${collectionName}`);
        return;
      }

      // Build CREATE INDEX statement
      const fieldList = fields.map((f: string) => `"${f}"`).join(', ');
      const createIndexSQL = `CREATE ${unique} INDEX "${indexName}" ON "${collectionName}" (${fieldList})${nullsNotDistinct}`;

      await sql.unsafe(createIndexSQL);
      console.log(`Created index ${indexName} on ${collectionName}`);
    } catch (error) {
      console.error(`Failed to create index on ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Remove an index (stub for compatibility)
   */
  async removeIndex(collectionName: string, indexName: string): Promise<void> {
    console.log(`Removing index ${indexName} from ${collectionName}`);
    // Stub for now
  }
}

/**
 * Export singleton instance
 */
export const schemaManager = SchemaManager.getInstance();

/**
 * Initialize schema manager
 */
export async function initializeSchemas(): Promise<void> {
  await schemaManager.initialize();
}

/**
 * Get schema by collection name
 */
export function getSchema(collectionName: string): any {
  return schemaManager.getSchema(collectionName);
}

/**
 * Get all schemas
 */
export function getAllSchemas(): Map<string, any> {
  return schemaManager.getAllSchemas();
}
