/**
 * Relation Loader Module for Drizzle ORM
 * 
 * This module provides utilities for building joins and loading related data
 * in Drizzle ORM, matching Sequelize's include/association behavior.
 * 
 * Features:
 * - BelongsTo join building
 * - HasOne join building  
 * - HasMany separate query loading
 * - BelongsToMany (M2M) through junction tables
 * - M2A polymorphic relations
 * - Nested relation loading (include.include)
 * - Relation filtering and ordering
 */

import { SQL, sql, eq, and, isNull } from 'drizzle-orm';
import { PgTable, PgColumn, alias } from 'drizzle-orm/pg-core';
import { schemaManager } from './schemaManager.js';
import { relationBuilder } from './relationUtils.js';
import { drizzleWhere, FilterObject } from './queryBuilder.js';
import { drizzleOrder, SortObject } from './orderUtils.js';
import type {
  RelationType,
  IncludeConfig,
  ProcessedInclude,
  ExpandedFieldsResult
} from '../types/index.js';

/**
 * Extract field paths and build include tree
 * 
 * @param fields - Array of field paths (e.g., ['id', 'name', 'author.name', 'author.posts.title'])
 * @param tableName - Main table name
 * @returns Expanded fields result with includes
 * 
 * @example
 * ```typescript
 * const fields = ['id', 'title', 'author.name', 'author.posts.title'];
 * const result = expandFieldsWithIncludes(fields, 'posts');
 * 
 * // result.directFields: ['id', 'title']
 * // result.includes: [
 * //   {
 * //     relation: 'author',
 * //     nested: [{ relation: 'posts', ... }]
 * //   }
 * // ]
 * ```
 */
/**
 * Expand nested wildcards recursively up to maxDepth levels
 * Example: "Review.*.*" expands to include all Review fields and all nested relations
 *
 * @param relationName - The relation to expand (e.g., "Review")
 * @param tableName - The source table name
 * @param wildcardCount - Number of wildcards after relation (e.g., 2 for "Review.*.*")
 * @param maxDepth - Maximum depth to expand (default 7)
 * @param currentDepth - Current recursion depth (internal use)
 * @returns IncludeConfig with expanded relations
 */
function expandNestedWildcards(
  relationName: string,
  tableName: string,
  wildcardCount: number,
  maxDepth: number = 7,
  currentDepth: number = 0
): IncludeConfig | null {
  // Stop if we've reached max depth
  if (currentDepth >= maxDepth || wildcardCount === 0) {
    return null;
  }

  // Get associations for the source table
  const associations = relationBuilder.getAssociations(tableName);
  if (!associations) {
    console.warn(`No associations found for table '${tableName}'`);
    return null;
  }

  const association = associations[relationName];
  if (!association) {
    console.warn(`Association '${relationName}' not found on ${tableName}`);
    return null;
  }

  // Start building the include config
  const config: IncludeConfig = {
    relation: relationName,
    attributes: ['*'], // First wildcard means all fields
    include: []
  };

  // If we have more wildcards, expand nested relations
  if (wildcardCount > 1) {
    const targetTable = association.model;
    const nestedAssociations = relationBuilder.getAssociations(targetTable);

    if (nestedAssociations) {
      // For each nested relation, recursively expand
      for (const [nestedRelationName, nestedAssoc] of Object.entries(nestedAssociations)) {
        const nestedConfig = expandNestedWildcards(
          nestedRelationName,
          targetTable,
          wildcardCount - 1,
          maxDepth,
          currentDepth + 1
        );

        if (nestedConfig) {
          config.include!.push(nestedConfig);
        }
      }
    }
  }

  return config;
}

export function expandFieldsWithIncludes(
  fields: string[],
  tableName: string
): ExpandedFieldsResult {
  const directFields: string[] = [];
  const relationMap = new Map<string, IncludeConfig>();

  for (const field of fields) {
    if (field === '*') {
      // Wildcard - get all direct fields
      const schema = schemaManager.getSchema(tableName);
      if (schema) {
        const allFields = Object.keys(schema);
        directFields.push(...allFields);
      }
      continue;
    }

    if (!field.includes('.')) {
      // Direct field
      if (!directFields.includes(field)) {
        directFields.push(field);
      }
    } else {
      // Relational field (e.g., 'author.name' or 'author.posts.title')
      const parts = field.split('.');
      const relationName = parts[0];
      const remainingPath = parts.slice(1).join('.');

      // Check if this is a nested wildcard pattern (e.g., "Review.*.*")
      const remainingParts = parts.slice(1);
      const wildcardCount = remainingParts.filter(p => p === '*').length;
      const isNestedWildcard = wildcardCount > 0 && remainingParts.every(p => p === '*');

      if (isNestedWildcard && wildcardCount >= 2) {
        // Handle nested wildcard expansion
        const expandedConfig = expandNestedWildcards(relationName, tableName, wildcardCount);
        if (expandedConfig) {
          if (relationMap.has(relationName)) {
            // Merge with existing config
            const existing = relationMap.get(relationName)!;
            if (!existing.attributes!.includes('*')) {
              existing.attributes!.push('*');
            }
            // Merge includes
            for (const nestedInc of expandedConfig.include!) {
              const existingNested = existing.include!.find(inc => inc.relation === nestedInc.relation);
              if (!existingNested) {
                existing.include!.push(nestedInc);
              } else {
                // Merge nested includes recursively
                mergeIncludeConfigs(existingNested, nestedInc);
              }
            }
          } else {
            relationMap.set(relationName, expandedConfig);
          }
        }
        continue;
      }

      if (!relationMap.has(relationName)) {
        relationMap.set(relationName, {
          relation: relationName,
          attributes: [],
          include: []
        });
      }

      const includeConfig = relationMap.get(relationName)!;

      if (parts.length === 2) {
        // Direct field on related table (e.g., 'author.name' or 'author.*')
        if (remainingPath === '*') {
          // Wildcard - mark for expansion later
          if (!includeConfig.attributes!.includes('*')) {
            includeConfig.attributes!.push('*');
          }
        } else if (!includeConfig.attributes!.includes(remainingPath)) {
          includeConfig.attributes!.push(remainingPath);
        }
      } else {
        // Nested relation (e.g., 'author.posts.title' or 'employee.department.company.*')
        // Recursively build nested include structure
        buildNestedInclude(includeConfig, parts.slice(1));
      }
    }
  }

  // Process includes
  const includes: ProcessedInclude[] = [];
  const relationPaths = new Map<string, ProcessedInclude>();

  for (const [relationName, config] of relationMap) {
    const processed = processIncludeConfig(config, tableName);
    if (processed) {
      includes.push(processed);
      relationPaths.set(relationName, processed);

      // Add nested relation paths
      for (const nested of processed.nested) {
        relationPaths.set(`${relationName}.${nested.relation}`, nested);
      }
    }
  }

  return {
    directFields,
    includes,
    relationPaths
  };
}

/**
 * Recursively build nested include structure for deep relation paths
 * E.g., for parts = ['department', 'company', '*'], creates:
 * { relation: 'department', attributes: [], include: [
 *   { relation: 'company', attributes: ['*'], include: [] }
 * ]}
 */
function buildNestedInclude(config: IncludeConfig, parts: string[]): void {
  if (parts.length === 0) return;

  if (parts.length === 1) {
    // This is a field/attribute, add it to the current config
    if (!config.attributes!.includes(parts[0])) {
      config.attributes!.push(parts[0]);
    }
    return;
  }

  // This is a nested relation
  const nestedRelation = parts[0];
  let nestedInclude = config.include!.find(inc => inc.relation === nestedRelation);
  if (!nestedInclude) {
    nestedInclude = {
      relation: nestedRelation,
      attributes: [],
      include: []
    };
    config.include!.push(nestedInclude);
  }

  // Recursively build the rest of the path
  buildNestedInclude(nestedInclude, parts.slice(1));
}

/**
 * Merge two IncludeConfig objects recursively
 */
function mergeIncludeConfigs(target: IncludeConfig, source: IncludeConfig): void {
  // Merge attributes
  for (const attr of source.attributes || []) {
    if (!target.attributes!.includes(attr)) {
      target.attributes!.push(attr);
    }
  }

  // Merge includes
  for (const sourceNested of source.include || []) {
    const targetNested = target.include!.find(inc => inc.relation === sourceNested.relation);
    if (!targetNested) {
      target.include!.push(sourceNested);
    } else {
      mergeIncludeConfigs(targetNested, sourceNested);
    }
  }
}

/**
 * Process include configuration into ProcessedInclude
 */
function processIncludeConfig(
  config: IncludeConfig,
  sourceTableName: string,
  parentPath: string = '',
  sourceAlias?: string // Alias of the source table (for nested relations)
): ProcessedInclude | null {
  // Get association info
  const associations = relationBuilder.getAssociations(sourceTableName);
  if (!associations) {
    console.warn(`No associations found for table '${sourceTableName}'`);
    return null;
  }

  const association = associations[config.relation];

  if (!association) {
    console.warn(`Association '${config.relation}' not found on ${sourceTableName}`);
    return null;
  }
  
  // Get target table
  const targetTable = schemaManager.getSchema(association.model);
  if (!targetTable) {
    console.warn(`Target table '${association.model}' not found`);
    return null;
  }

  // Expand wildcard in attributes
  let expandedAttributes = config.attributes || [];
  if (expandedAttributes.includes('*')) {
    // Remove the wildcard and add all actual fields
    expandedAttributes = expandedAttributes.filter(attr => attr !== '*');
    const allFields = Object.keys(targetTable);
    expandedAttributes.push(...allFields);
  } else if (expandedAttributes.length === 0 && config.include && config.include.length > 0) {
    // If no attributes specified but has nested includes, automatically include all fields
    // This ensures junction tables in M2M relations can load nested data properly
    // e.g., "tags.tags.name" should load junction table fields even without "tags.*"
    const allFields = Object.keys(targetTable);
    expandedAttributes.push(...allFields);
  }

  // Create a unique alias for the target table
  // For nested relations with same name (e.g., M2M junction.target where both named "chapters"),
  // we need to include the parent path to avoid alias conflicts
  // E.g., "chapters" vs "chapters__chapters" for nested same-name relations
  const uniqueAlias = parentPath ? `${parentPath.replace(/\./g, '__')}__${config.relation}` : config.relation;
  
  // Create an alias for the target table using the unique alias
  // This allows joining the same table multiple times with different aliases
  const aliasedTable = alias(targetTable as any, uniqueAlias);

  // Build join condition based on relation type
  // Use sourceAlias (if provided) for JOIN SQL, otherwise use sourceTableName
  // This is critical for nested relations where the parent is aliased
  const joinCondition = buildJoinCondition(association, sourceAlias || sourceTableName, uniqueAlias);
  
  // Process where clause
  // Use unique alias as tableName for proper alias resolution
  let whereClause: SQL | undefined;
  if (config.where) {
    whereClause = drizzleWhere(config.where, {
      tableName: uniqueAlias,
      schema: aliasedTable
    });
  }
  
  // Process nested includes
  const nested: ProcessedInclude[] = [];
  if (config.include && config.include.length > 0) {
    for (const nestedConfig of config.include) {
      const processedNested = processIncludeConfig(
        nestedConfig,
        association.model,
        parentPath ? `${parentPath}.${config.relation}` : config.relation,
        uniqueAlias // Pass unique alias as the source alias for nested includes
      );
      if (processedNested) {
        nested.push(processedNested);
      }
    }
  }
  
  // Determine if separate query needed (for HasMany)
  const separate = config.separate !== undefined 
    ? config.separate 
    : association.type === 'HasMany';
  
  return {
    relation: config.relation,
    relationType: association.type as RelationType,
    table: aliasedTable as unknown as PgTable,
    joinCondition,
    where: whereClause,
    attributes: expandedAttributes,
    nested,
    required: config.required || false,
    separate,
    alias: uniqueAlias // Store the unique alias for use in queries
  };
}

/**
 * Build join condition for an association
 */
function buildJoinCondition(association: any, sourceTableName: string, relationName: string = ''): SQL {
  const { type, foreignKey, model } = association;
  const targetKey = association.targetKey || 'id';

  // Use relationName as the table alias in JOIN conditions
  // This allows joining the same table multiple times with different aliases
  const targetTableName = relationName || model;

  switch (type) {
    case 'BelongsTo':
      // Source.foreignKey = Target.targetKey (usually id)
      return sql`${sql.raw(`"${sourceTableName}"."${foreignKey}"`)} = ${sql.raw(`"${targetTableName}"."${targetKey}"`)}`;

    case 'HasOne':
    case 'HasMany':
      // Target.foreignKey = Source.id
      return sql`${sql.raw(`"${targetTableName}"."${foreignKey}"`)} = ${sql.raw(`"${sourceTableName}"."id"`)}`;

    case 'BelongsToMany':
      // Requires junction table - handle separately
      const { through, otherKey } = association;
      if (through) {
        // Source.id = Junction.foreignKey
        // Junction.otherKey = Target.id
        return sql`${sql.raw(`"${sourceTableName}"."id"`)} = ${sql.raw(`"${through}"."${foreignKey}"`)} AND ${sql.raw(`"${through}"."${otherKey}"`)} = ${sql.raw(`"${targetTableName}"."id"`)}`;
      }
      throw new Error(`BelongsToMany association '${relationName}' missing through table`);

    case 'M2A':
      // Polymorphic - Target.id = Source.foreignKey AND Target.type = Source.typeKey
      const typeKey = association.typeKey || `${relationName}Type`;
      const typeValue = association.typeValue || model;
      return and(
        sql`${sql.raw(`"${targetTableName}"."id"`)} = ${sql.raw(`"${sourceTableName}"."${foreignKey}"`)}`,
        sql`${sql.raw(`"${sourceTableName}"."${typeKey}"`)} = ${typeValue}`
      ) || sql`1=1`;

    default:
      throw new Error(`Unknown relation type: ${type}`);
  }
}

/**
 * Build LEFT JOIN clause for includes
 * Only for BelongsTo and HasOne relations
 * HasMany will use separate queries
 */
export function buildJoinsForIncludes(includes: ProcessedInclude[]): SQL[] {
  const joins: SQL[] = [];
  
  for (const include of includes) {
    if (include.separate) {
      // Skip - will be loaded separately
      continue;
    }
    
    if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
      // Build LEFT JOIN or INNER JOIN
      const joinType = include.required ? 'INNER JOIN' : 'LEFT JOIN';
      const tableName = include.table;
      
      let joinClause = sql`${sql.raw(joinType)} ${sql.raw(String(tableName))} ON ${include.joinCondition}`;
      
      // Add WHERE conditions to join
      if (include.where) {
        joinClause = sql`${joinClause} AND ${include.where}`;
      }
      
      joins.push(joinClause);
      
      // Process nested joins
      if (include.nested.length > 0) {
        const nestedJoins = buildJoinsForIncludes(include.nested);
        joins.push(...nestedJoins);
      }
    }
  }
  
  return joins;
}

/**
 * Load HasMany relations with separate queries
 * This is more efficient than joining for one-to-many relations
 */
export async function loadHasManyRelations(
  db: any,
  mainRecords: any[],
  includes: ProcessedInclude[],
  sourceTableName: string
): Promise<any[]> {
  if (!mainRecords || mainRecords.length === 0) {
    return mainRecords;
  }

  for (const include of includes) {
    // If this include has nested HasMany relations, we need to load them even if this include itself is not separate
    // Example: customer_products → product (BelongsTo) → product_contracts (HasMany)
    if ((!include.separate || include.relationType !== 'HasMany') && include.nested.length > 0) {
      // Check if there are nested HasMany relations
      const hasNestedSeparate = include.nested.some(n => n.separate && n.relationType === 'HasMany');
      if (hasNestedSeparate) {
        // For BelongsTo/HasOne relations, the nested records are already loaded and attached
        // We need to collect those nested records and call loadNestedRelationsForHasMany
        const nestedRecords: any[] = [];
        for (const mainRecord of mainRecords) {
          const nestedRecord = mainRecord[include.relation];
          if (nestedRecord) {
            // For BelongsTo/HasOne, it's a single record
            nestedRecords.push(nestedRecord);
          }
        }

        if (nestedRecords.length > 0) {
          // Get the target table name for this include
          const associationsMap = relationBuilder.getAssociations(sourceTableName);
          const association = associationsMap?.[include.relation];
          if (association) {
            // Recursively load HasMany relations for these nested records
            await loadNestedRelationsForHasMany(
              db,
              nestedRecords,
              include.nested,
              association.model
            );
          }
        }
      }
      continue;
    }

    if (!include.separate || include.relationType !== 'HasMany') {
      continue;
    }

    // Get association info
    const associationsMap = relationBuilder.getAssociations(sourceTableName);
    if (!associationsMap) continue;

    const association = associationsMap[include.relation];
    if (!association) continue;

    // Skip polymorphic (M2A) relations - they're handled by loadM2ARelations
    if (association.polymorphic) {
      console.log(`[loadHasManyRelations] Skipping polymorphic relation: ${include.relation}`);
      continue;
    }

    // Get primary key for source table (usually 'id' but could be different)
    const sourceTable = schemaManager.getSchema(sourceTableName);
    const sourcePrimaryKey = schemaManager.getPrimaryKey(sourceTableName) || 'id';

    // Get IDs from main records using the correct primary key
    const mainIds = mainRecords.map(r => r[sourcePrimaryKey]).filter(Boolean);
    if (mainIds.length === 0) continue;
    
    // Build query for related records
    const targetTable = include.table;
    const foreignKey = association.foreignKey || `${sourceTableName}Id`;
    
    // Build where clause: foreignKey IN (mainIds) AND optional filters
    let whereConditions: SQL[] = [
      sql`${sql.raw(`"${foreignKey}"`)} IN (${sql.join(mainIds.map(id => sql`${id}`), sql`, `)})`
    ];

    // Handle where filter
    // If it's a FilterObject, rebuild it using the actual target table
    // If it's SQL, it was built with an aliased table, so we can't use it directly - skip it
    if (include.where) {
      // Check if it's a FilterObject (has properties like AND, OR, field names)
      // vs SQL object (has queryChunks property)
      const isFilterObject = !('queryChunks' in include.where);

      if (isFilterObject) {
        // It's a FilterObject from relConditions - build SQL for target table
        // Use include.alias if available for proper table alias reference in SQL
        const filterJoins: any[] = [];
        const rebuiltWhere = drizzleWhere(include.where as FilterObject, {
          table: targetTable,
          tableName: include.alias || association.model,
          schema: targetTable as any,
          joins: filterJoins
        });

        if (rebuiltWhere) {
          whereConditions.push(rebuiltWhere);
        }

        // If the filter created joins, we need to apply them to the query
        // For now, log a warning as this is an edge case
        if (filterJoins.length > 0) {
          console.warn('[loadHasManyRelations] Relation filters with nested paths not fully supported yet');
        }
      } else {
        // It's a SQL object built with an aliased table - we can't use it in a separate query
        // Log a warning and skip it
        console.warn('[loadHasManyRelations] SQL where filters built with aliases are not supported in separate queries');
      }
    }
    
    // Check if target table has soft deletes (paranoid mode)
    const isParanoid = schemaManager.isParanoid(association.model);
    if (isParanoid) {
      const deletedAtColumn = targetTable['deletedAt'];
      if (deletedAtColumn) {
        whereConditions.push(isNull(deletedAtColumn));
      }
    }
    
    const whereClause = whereConditions.length > 1
      ? and(...whereConditions)
      : whereConditions[0];

    // Build select columns - respect include.attributes
    let selectColumns: Record<string, any> = {};
    if (include.attributes && include.attributes.length > 0) {
      // Select only specified attributes
      for (const attr of include.attributes) {
        const column = targetTable[attr];
        if (column) {
          selectColumns[attr] = column;
        }
      }
    }

    // Always include the foreign key so we can group by it
    if (!selectColumns[foreignKey] && targetTable[foreignKey]) {
      selectColumns[foreignKey] = targetTable[foreignKey];
    }

    // Execute query with specific columns or all columns
    const relatedRecords = await db
      .select(Object.keys(selectColumns).length > 0 ? selectColumns : undefined)
      .from(targetTable)
      .where(whereClause);
    
    // Group by foreign key
    const groupedRecords = new Map<any, any[]>();
    for (const record of relatedRecords) {
      const fkValue = (record as any)[foreignKey!];
      if (!groupedRecords.has(fkValue)) {
        groupedRecords.set(fkValue, []);
      }
      groupedRecords.get(fkValue)!.push(record);
    }

    // Attach to main records using correct primary key
    for (const mainRecord of mainRecords) {
      mainRecord[include.relation] = groupedRecords.get(mainRecord[sourcePrimaryKey]) || [];
    }

    // Load nested relations for the HasMany records
    if (include.nested && include.nested.length > 0) {
      await loadNestedRelationsForHasMany(
        db,
        relatedRecords,
        include.nested,
        association.model
      );

      // Update grouped records with nested data using correct primary key
      for (const mainRecord of mainRecords) {
        const recordsForThis = groupedRecords.get(mainRecord[sourcePrimaryKey]) || [];
        mainRecord[include.relation] = recordsForThis;
      }
    }
  }

  return mainRecords;
}

/**
 * Load nested relations for HasMany records
 * This handles nested includes within HasMany relations (e.g., userRoles.role)
 */
async function loadNestedRelationsForHasMany(
  db: any,
  records: any[],
  includes: ProcessedInclude[],
  sourceTableName: string
): Promise<void> {
  if (!records || records.length === 0) {
    return;
  }

  for (const include of includes) {
    // For BelongsTo and HasOne, we can load them directly
    if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
      // Get association info
      const associationsMap = relationBuilder.getAssociations(sourceTableName);
      if (!associationsMap) continue;

      const association = associationsMap[include.relation];
      if (!association) continue;

      // Get foreign key values from records
      const foreignKey = association.foreignKey;
      const targetKey = (association as any).targetKey || 'id';
      const foreignKeyValues = records
        .map(r => r[foreignKey])
        .filter(v => v != null);

      if (foreignKeyValues.length === 0) continue;

      // Load related records
      const targetTable = include.table;
      let whereConditions: SQL[] = [
        sql`${sql.raw(`"${targetKey}"`)} IN (${sql.join(
          [...new Set(foreignKeyValues)].map(id => sql`${id}`),
          sql`, `
        )})`
      ];

      // Handle where filter - check if it's a FilterObject or SQL
      if (include.where) {
        const isFilterObject = !('queryChunks' in include.where);

        if (isFilterObject) {
          // It's a FilterObject from relConditions - build SQL for target table
          // Use include.alias if available for proper table alias reference in SQL
          const filterJoins: any[] = [];
          const rebuiltWhere = drizzleWhere(include.where as FilterObject, {
            table: targetTable,
            tableName: include.alias || association.model,
            schema: targetTable as any,
            joins: filterJoins
          });

          if (rebuiltWhere) {
            whereConditions.push(rebuiltWhere);
          }
        } else {
          // It's already SQL
          whereConditions.push(include.where as SQL);
        }
      }

      const whereClause = whereConditions.length > 1
        ? and(...whereConditions)
        : whereConditions[0];

      // Build select columns - respect include.attributes
      let selectColumns: Record<string, any> = {};
      if (include.attributes && include.attributes.length > 0) {
        // Select only specified attributes
        for (const attr of include.attributes) {
          const column = targetTable[attr];
          if (column) {
            selectColumns[attr] = column;
          }
        }
      }

      // Always include the targetKey so we can match records
      if (!selectColumns[targetKey] && targetTable[targetKey]) {
        selectColumns[targetKey] = targetTable[targetKey];
      }

      // Execute query with specific columns or all columns
      const relatedRecords = await db
        .select(Object.keys(selectColumns).length > 0 ? selectColumns : undefined)
        .from(targetTable)
        .where(whereClause);

      // Create a map of related records by target key
      const relatedMap = new Map(
        relatedRecords.map((r: any) => [r[targetKey], r])
      );

      // Attach to records
      for (const record of records) {
        const fkValue = record[foreignKey];
        if (fkValue != null) {
          if (include.relationType === 'BelongsTo') {
            record[include.relation] = relatedMap.get(fkValue) || null;
          } else {
            // HasOne
            record[include.relation] = relatedMap.get(fkValue) || null;
          }
        } else {
          record[include.relation] = null;
        }
      }

      // Recursively load nested includes
      if (include.nested && include.nested.length > 0 && relatedRecords.length > 0) {
        await loadNestedRelationsForHasMany(
          db,
          relatedRecords,
          include.nested,
          association.model
        );
      }
    } else if (include.relationType === 'HasMany') {
      // Check if this is a polymorphic (M2A) relation
      const associationsMap = relationBuilder.getAssociations(sourceTableName);
      const association = associationsMap?.[include.relation];
      
      if (association?.polymorphic) {
        // Handle M2A relations
        await loadM2ARelations(db, records, [include], sourceTableName);
      } else {
        // Recursively handle nested HasMany (non-polymorphic)
        await loadHasManyRelations(db, records, [include], sourceTableName);
      }
    }
  }
}

/**
 * Load M2A (polymorphic) relations with junction table
 */
export async function loadM2ARelations(
  db: any,
  mainRecords: any[],
  includes: ProcessedInclude[],
  sourceTableName: string
): Promise<any[]> {
  if (!mainRecords || mainRecords.length === 0) {
    return mainRecords;
  }

  for (const include of includes) {
    // Only process polymorphic HasMany relations (M2A)
    if (!include.separate || include.relationType !== 'HasMany') {
      continue;
    }

    // Get association info
    const associationsMap = relationBuilder.getAssociations(sourceTableName);
    if (!associationsMap) continue;

    const association = associationsMap[include.relation];
    if (!association || !association.polymorphic) continue; // Only handle polymorphic

    console.log(`[loadM2ARelations] Loading M2A relation: ${include.relation}`);

    // Get junction table (target is the junction table for M2A)
    const junctionTable = schemaManager.getSchema(association.model);
    if (!junctionTable) {
      console.warn(`Junction table '${association.model}' not found for M2A relation`);
      continue;
    }

    // Get primary key for source table
    const sourcePrimaryKey = schemaManager.getPrimaryKey(sourceTableName) || 'id';
    const mainIds = mainRecords.map(r => r[sourcePrimaryKey]).filter(Boolean);
    if (mainIds.length === 0) continue;

    const foreignKey = association.foreignKey || `${sourceTableName}_id`;

    // Load junction records
    const junctionRecords = await db
      .select()
      .from(junctionTable)
      .where(sql`${sql.raw(`"${foreignKey}"`)} IN (${sql.join(mainIds.map(id => sql`${id}`), sql`, `)})`);

    console.log(`[loadM2ARelations] Loaded ${junctionRecords.length} junction records`);

    if (junctionRecords.length === 0) {
      // No related records - set empty arrays
      for (const mainRecord of mainRecords) {
        mainRecord[include.relation] = [];
      }
      continue;
    }

    // Group junction records by collection type
    const recordsByCollection = new Map<string, any[]>();
    for (const junctionRecord of junctionRecords) {
      const collectionName = junctionRecord.collection;
      if (!recordsByCollection.has(collectionName)) {
        recordsByCollection.set(collectionName, []);
      }
      recordsByCollection.get(collectionName)!.push(junctionRecord);
    }

    console.log(`[loadM2ARelations] Collections found:`, Array.from(recordsByCollection.keys()));

    // Determine which collections to load based on nested includes
    // If nested includes are specified, only load those collections
    // If no nested includes, load all collections found in junction records
    let collectionsToLoad: string[];
    console.log(`[loadM2ARelations] include.nested:`, include.nested?.map(n => ({ relation: n.relation, attributes: n.attributes })));

    if (include.nested && include.nested.length > 0) {
      // Extract collection names from nested includes
      collectionsToLoad = include.nested.map(n => n.relation);
      console.log(`[loadM2ARelations] Loading only requested collections:`, collectionsToLoad);
    } else {
      // Load all collections found
      collectionsToLoad = Array.from(recordsByCollection.keys());
      console.log(`[loadM2ARelations] Loading all collections found in junction records`);
    }

    // For each collection, load the target records
    for (const collectionName of collectionsToLoad) {
      const junctionRecs = recordsByCollection.get(collectionName);
      if (!junctionRecs || junctionRecs.length === 0) {
        console.log(`[loadM2ARelations] No junction records found for collection ${collectionName}`);
        continue;
      }

      const targetTable = schemaManager.getSchema(collectionName);
      if (!targetTable) {
        console.warn(`Target table '${collectionName}' not found for M2A relation`);
        continue;
      }

      const targetIds = junctionRecs.map(r => r.item_id).filter(Boolean);
      if (targetIds.length === 0) continue;

      // Query target table
      const targetRecords = await db
        .select()
        .from(targetTable)
        .where(sql`"id" IN (${sql.join(targetIds.map(id => sql`${id}`), sql`, `)})`);

      console.log(`[loadM2ARelations] Loaded ${targetRecords.length} records from ${collectionName}`);

      // Create map of target records by ID
      const targetMap = new Map(targetRecords.map((r: any) => [r.id, r]));

      // Attach target records to junction records
      for (const junctionRec of junctionRecs) {
        const targetRecord = targetMap.get(junctionRec.item_id);
        if (targetRecord) {
          // Attach as nested object with collection name as key
          junctionRec[collectionName] = targetRecord;
        }
      }
    }

    // Filter junction records to only include those with loaded collections
    // This prevents returning junction records for collections we didn't load
    // IMPORTANT: Do this BEFORE processing nested includes
    const filteredJunctionRecords = junctionRecords.filter(jr => {
      const hasLoadedCollection = collectionsToLoad.includes(jr.collection);
      if (!hasLoadedCollection) {
        console.log(`[loadM2ARelations] Filtering out junction record for unloaded collection: ${jr.collection}`);
      }
      return hasLoadedCollection;
    });

    console.log(`[loadM2ARelations] Filtered junction records count: ${filteredJunctionRecords.length} (from ${junctionRecords.length})`);

    // Process nested includes on filtered junction records if any
    if (include.nested && include.nested.length > 0) {
      await loadNestedRelationsForHasMany(
        db,
        filteredJunctionRecords,  // Use filtered records
        include.nested,
        association.model
      );
    }

    // Group junction records by source ID
    const groupedRecords = new Map<any, any[]>();
    for (const junctionRecord of filteredJunctionRecords) {
      const sourceId = junctionRecord[foreignKey];
      if (!groupedRecords.has(sourceId)) {
        groupedRecords.set(sourceId, []);
      }
      groupedRecords.get(sourceId)!.push(junctionRecord);
    }

    // Attach to main records
    for (const mainRecord of mainRecords) {
      mainRecord[include.relation] = groupedRecords.get(mainRecord[sourcePrimaryKey]) || [];
    }

    console.log(`[loadM2ARelations] Completed M2A relation: ${include.relation}`);
  }

  return mainRecords;
}

/**
 * Load BelongsToMany (M2M) relations with junction table
 */
export async function loadBelongsToManyRelations(
  db: any,
  mainRecords: any[],
  includes: ProcessedInclude[],
  sourceTableName: string
): Promise<any[]> {
  if (!mainRecords || mainRecords.length === 0) {
    return mainRecords;
  }
  
  for (const include of includes) {
    if (include.relationType !== 'BelongsToMany') {
      continue;
    }

    // Get association info
    const associationsMap = relationBuilder.getAssociations(sourceTableName);
    if (!associationsMap) continue;

    const association = associationsMap[include.relation];
    if (!association || !association.through) continue;

    // Get primary key for source table
    const sourcePrimaryKey = schemaManager.getPrimaryKey(sourceTableName) || 'id';

    // Get IDs from main records using correct primary key
    const mainIds = mainRecords.map(r => r[sourcePrimaryKey]).filter(Boolean);
    if (mainIds.length === 0) continue;
    
    // Get junction and target tables
    const junctionTable = schemaManager.getSchema(association.through);
    const targetTable = include.table;
    
    if (!junctionTable) {
      console.warn(`Junction table '${association.through}' not found`);
      continue;
    }
    
    const foreignKey = association.foreignKey || `${sourceTableName}Id`; // Key in junction pointing to source
    const otherKey = association.otherKey || `${association.model}Id`; // Key in junction pointing to target
    
    // Query junction table
    const junctionRecords = await db
      .select()
      .from(junctionTable)
      .where(sql`${sql.raw(`"${foreignKey}"`)} IN (${sql.join(mainIds.map(id => sql`${id}`), sql`, `)})`);
    
    // Get target IDs from junction
    const targetIds = [...new Set(junctionRecords.map((r: any) => r[otherKey!]))];
    
    if (targetIds.length === 0) {
      // No related records - set empty arrays
      for (const mainRecord of mainRecords) {
        mainRecord[include.relation] = [];
      }
      continue;
    }
    
    // Query target table
    let whereConditions: SQL[] = [
      sql`"id" IN (${sql.join(targetIds.map(id => sql`${id}`), sql`, `)})`
    ];

    if (include.where) {
      whereConditions.push(include.where as any);
    }
    
    const whereClause = whereConditions.length > 1
      ? and(...whereConditions)
      : whereConditions[0];

    // Build select columns - respect include.attributes
    let selectColumns: Record<string, any> = {};
    if (include.attributes && include.attributes.length > 0) {
      // Select only specified attributes
      for (const attr of include.attributes) {
        const column = targetTable[attr];
        if (column) {
          selectColumns[attr] = column;
        }
      }
    }

    // Always include 'id' so we can map records
    if (!selectColumns.id && (targetTable as any).id) {
      selectColumns.id = (targetTable as any).id;
    }

    const targetRecords = await db
      .select(Object.keys(selectColumns).length > 0 ? selectColumns : undefined)
      .from(targetTable)
      .where(whereClause);
    
    // Create target records map
    const targetMap = new Map(targetRecords.map((r: any) => [r.id, r]));
    
    // Group by source ID
    const groupedRecords = new Map<any, any[]>();
    for (const junctionRecord of junctionRecords) {
      const sourceId = (junctionRecord as any)[foreignKey!];
      const targetId = (junctionRecord as any)[otherKey!];
      const targetRecord = targetMap.get(targetId);
      
      if (targetRecord) {
        if (!groupedRecords.has(sourceId)) {
          groupedRecords.set(sourceId, []);
        }
        groupedRecords.get(sourceId)!.push(targetRecord);
      }
    }

    // Attach to main records using correct primary key
    for (const mainRecord of mainRecords) {
      mainRecord[include.relation] = groupedRecords.get(mainRecord[sourcePrimaryKey]) || [];
    }
  }

  return mainRecords;
}

/**
 * Load all separate-query relations (HasMany, BelongsToMany)
 */
/**
 * Nest flattened BelongsTo/HasOne relation data from JOINs
 * Converts { "category.name": "Electronics", "category.id": "123" }
 * to { category: { name: "Electronics", id: "123" } }
 */
export function nestJoinedRelations(
  records: any[],
  includes: ProcessedInclude[],
  parentPath: string = ''
): any[] {
  if (!records || records.length === 0) return records;

  return records.map(record => {
    const nested: any = { ...record };

    // Process each include
    for (const include of includes) {
      // Skip separate queries (HasMany, BelongsToMany) - they're handled elsewhere
      if (include.separate) continue;

      // Only nest BelongsTo and HasOne relations
      if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
        const relationName = include.relation;
        const fullPath = parentPath ? `${parentPath}.${relationName}` : relationName;
        const relationData: any = {};
        let hasData = false;
        let hasNonNullValue = false;

        // Extract all fields for this relation from the full path
        for (const key in record) {
          if (key.startsWith(`${fullPath}.`)) {
            const fieldName = key.substring(fullPath.length + 1);
            relationData[fieldName] = record[key];
            hasData = true;
            // Check if at least one value is non-null
            if (record[key] !== null && record[key] !== undefined) {
              hasNonNullValue = true;
            }
            // Remove the flattened field
            delete nested[key];
          }
        }

        // Only add the nested object if it has data with at least one non-null value
        // If all values are null, the foreign key was null, so set the relation to null
        if (hasData) {
          nested[relationName] = hasNonNullValue ? relationData : null;
        }

        // Recursively nest nested includes
        // Note: We pass empty parentPath because the nested object's keys don't include the parent prefix
        if (include.nested && include.nested.length > 0 && nested[relationName]) {
          const nestedArray = [nested[relationName]];
          const result = nestJoinedRelations(nestedArray, include.nested, '');
          nested[relationName] = result[0];
        }
      }
    }

    return nested;
  });
}

export async function loadSeparateRelations(
  db: any,
  mainRecords: any[],
  includes: ProcessedInclude[],
  sourceTableName: string
): Promise<any[]> {
  // First, nest the joined BelongsTo/HasOne relations
  const nestedRecords = nestJoinedRelations(mainRecords, includes);

  // Load M2A (polymorphic) relations
  await loadM2ARelations(db, nestedRecords, includes, sourceTableName);

  // Then load HasMany relations
  await loadHasManyRelations(db, nestedRecords, includes, sourceTableName);

  // Load BelongsToMany relations
  await loadBelongsToManyRelations(db, nestedRecords, includes, sourceTableName);

  return nestedRecords;
}

/**
 * Build complete select with joins
 * Returns SELECT columns and JOIN clauses
 */
export function buildSelectWithJoins(
  mainTable: PgTable,
  directFields: string[],
  includes: ProcessedInclude[]
): {
  selectColumns: Record<string, any>;
  joins: SQL[];
} {
  const selectColumns: Record<string, any> = {};

  // Extract table name from PgTable object
  // Drizzle stores table name in [Table.Symbol.Name] property
  const mainTableName = (mainTable as any)[Symbol.for('drizzle:Name')] || (mainTable as any)._.name || 'unknown';

  // Add direct fields from main table using actual column references
  // This is required by Drizzle's select() method
  for (const field of directFields) {
    // Use the actual column from the table schema
    const column = mainTable[field];
    if (column) {
      selectColumns[field] = column;
    } else {
      console.warn(`[buildSelectWithJoins] Column '${field}' not found in table '${mainTableName}'`);
      console.warn(`[buildSelectWithJoins] Available columns:`, Object.keys(mainTable).filter(k => !k.startsWith('_') && k !== (Symbol.for('drizzle:Name') as any)));
    }
  }
  
  // Add fields from joined relations
  for (const include of includes) {
    if (include.separate) continue; // Skip separate query relations

    const relationAlias = include.relation;
    const relationTable = include.table;

    for (const attr of include.attributes) {
      const columnKey = `${relationAlias}.${attr}`;
      // Use actual column from the relation table
      const column = relationTable[attr];
      if (column) {
        selectColumns[columnKey] = column;
      } else {
        console.warn(`Column '${attr}' not found in relation table '${relationAlias}'`);
      }
    }

    // Process nested includes
    if (include.nested.length > 0) {
      addNestedSelectColumns(selectColumns, include.nested, relationAlias);
    }
  }
  
  // Build join clauses
  const joins = buildJoinsForIncludes(includes);
  
  return { selectColumns, joins };
}

/**
 * Add nested relation columns to select
 */
function addNestedSelectColumns(
  selectColumns: Record<string, any>,
  includes: ProcessedInclude[],
  parentPath: string = ''
): void {
  for (const include of includes) {
    if (include.separate) continue;

    const relationAlias = include.relation;
    const relationTable = include.table;
    const fullPath = parentPath ? `${parentPath}.${relationAlias}` : relationAlias;

    for (const attr of include.attributes) {
      const columnKey = `${fullPath}.${attr}`;
      // Use actual column from the relation table
      const column = relationTable[attr];
      if (column) {
        selectColumns[columnKey] = column;
      } else {
        console.warn(`Column '${attr}' not found in nested relation table '${relationAlias}'`);
      }
    }

    if (include.nested.length > 0) {
      addNestedSelectColumns(selectColumns, include.nested, fullPath);
    }
  }
}

/**
 * Utility: Check if any include requires separate query
 */
export function hasSeparateQueries(includes: ProcessedInclude[]): boolean {
  for (const include of includes) {
    if (include.separate) return true;
    if (include.nested.length > 0 && hasSeparateQueries(include.nested)) {
      return true;
    }
  }
  return false;
}

/**
 * Utility: Get all relation names from includes (flat list)
 */
export function getRelationNames(includes: ProcessedInclude[]): string[] {
  const names: string[] = [];
  
  for (const include of includes) {
    names.push(include.relation);
    if (include.nested.length > 0) {
      const nestedNames = getRelationNames(include.nested);
      names.push(...nestedNames.map(n => `${include.relation}.${n}`));
    }
  }
  
  return names;
}
