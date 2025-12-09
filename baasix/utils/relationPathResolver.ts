/**
 * Relation Path Resolver
 *
 * Resolves nested relation paths (e.g., "userRoles.role.name") into table joins
 * and column references for use in WHERE clauses.
 *
 */

import { SQL, sql, eq, aliasedTable } from 'drizzle-orm';
import { schemaManager } from './schemaManager.js';
import { relationBuilder } from './relationUtils.js';
import type { JoinDefinition, ResolvedPath } from '../types/index.js';

// Re-export types for backward compatibility
export type { JoinDefinition, ResolvedPath };

/**
 * Resolve a relation path into joins and column reference
 *
 * Example: "userRoles.role.name" becomes:
 * - JOIN userRoles table
 * - JOIN roles table through userRoles
 * - Return roles.name column
 */
export function resolveRelationPath(
  basePath: string,
  baseTable: any,
  baseTableName: string,
  baseAlias?: string,
  forPermissionCheck?: boolean
): ResolvedPath {
  // Parse the path into segments
  const segments = basePath.split('.');

  // If no dots, it's a direct column
  if (segments.length === 1) {
    const columnName = segments[0];
    const column = baseTable[columnName];
    const alias = baseAlias || baseTableName;

    return {
      column: column || null,
      columnPath: `${alias}.${columnName}`,
      joins: [],
      finalTable: baseTable,
      finalAlias: alias
    };
  }

  // Multi-segment path - need to resolve relations
  return resolveSegments(
    segments,
    baseTable,
    baseTableName,
    baseAlias || baseTableName,
    [],
    forPermissionCheck
  );
}

/**
 * Recursively resolve path segments
 */
function resolveSegments(
  segments: string[],
  currentTable: any,
  currentTableName: string,
  currentAlias: string,
  accumulatedJoins: JoinDefinition[],
  forPermissionCheck?: boolean
): ResolvedPath {
  // Base case: only one segment left
  if (segments.length === 1) {
    const columnName = segments[0];
    const column = currentTable[columnName];

    return {
      column: column || null,
      columnPath: `"${currentAlias}"."${columnName}"`,
      joins: accumulatedJoins,
      finalTable: currentTable,
      finalAlias: currentAlias
    };
  }

  // Get the first segment (relation name)
  const relationName = segments[0];
  const remainingSegments = segments.slice(1);

  // Look up the relation metadata
  const associations = relationBuilder.getAssociations(currentTableName);
  if (!associations || !associations[relationName]) {
    console.warn(`[relationPathResolver] Relation '${relationName}' not found in '${currentTableName}'`);

    // Try to treat it as a direct column with dots (edge case)
    const fullColumnName = segments.join('.');
    return {
      column: null,
      columnPath: `"${currentAlias}"."${fullColumnName}"`,
      joins: accumulatedJoins,
      finalTable: currentTable,
      finalAlias: currentAlias
    };
  }

  const relation = associations[relationName];
  const relationType = relation.type;
  const targetTableName = relation.model;

  // Get the target table
  const targetTable = schemaManager.getTable(targetTableName);
  if (!targetTable) {
    console.warn(`[relationPathResolver] Target table '${targetTableName}' not found`);
    return {
      column: null,
      columnPath: `"${currentAlias}"."${relationName}"`,
      joins: accumulatedJoins,
      finalTable: currentTable,
      finalAlias: currentAlias
    };
  }

  // Create a unique alias for the joined table
  const targetAlias = `${targetTableName}_${relationName}_${accumulatedJoins.length}`;

  // Create aliased table for Drizzle query builder
  const aliasedTargetTable = aliasedTable(targetTable, targetAlias);

  // Build the JOIN based on relation type
  let joinCondition: SQL;
  let conditionSQL: string;

  // Get current table reference
  // NOTE: currentTable is already aliased from previous iteration (if any)
  // Don't create a new alias - just use it directly
  const currentTableRef = currentTable;

  if (relationType === 'BelongsTo') {
    // BelongsTo: current table has foreign key pointing to target's primary key
    const foreignKey = relation.foreignKey || `${relationName}_Id`;
    const targetPK = schemaManager.getPrimaryKey(targetTableName) || 'id';

    // Build JOIN condition using Drizzle column references
    conditionSQL = `"${currentAlias}"."${foreignKey}" = "${targetAlias}"."${targetPK}"`;
    joinCondition = eq(currentTableRef[foreignKey], aliasedTargetTable[targetPK]);
  } else if (relationType === 'HasMany' || relationType === 'HasOne') {
    // HasMany/HasOne: target table has foreign key pointing to current's primary key
    const foreignKey = relation.foreignKey || `${currentTableName.toLowerCase()}_Id`;
    const currentPK = schemaManager.getPrimaryKey(currentTableName) || 'id';

    // Build JOIN condition using Drizzle column references
    conditionSQL = `"${targetAlias}"."${foreignKey}" = "${currentAlias}"."${currentPK}"`;
    joinCondition = eq(aliasedTargetTable[foreignKey], currentTableRef[currentPK]);
  } else if (relationType === 'BelongsToMany') {
    // BelongsToMany: through a junction table
    // For permission checks on M2M relations, we need to join through the junction table
    // Current limitation: This treats M2M like HasMany which may not work for all cases
    // Full M2M join would require: current -> junction -> target (two joins)
    const junctionTable = relation.through;
    if (junctionTable) {
      // If junction table is defined, we should join through it
      // For now, log a warning - full implementation would add two joins
      console.warn(`[relationPathResolver] BelongsToMany via junction ${junctionTable} - using simplified join`);
    }

    const foreignKey = relation.foreignKey || `${currentTableName.toLowerCase()}_Id`;
    const currentPK = schemaManager.getPrimaryKey(currentTableName) || 'id';

    conditionSQL = `"${targetAlias}"."${foreignKey}" = "${currentAlias}"."${currentPK}"`;
    joinCondition = eq(aliasedTargetTable[foreignKey], currentTableRef[currentPK]);
  } else {
    console.warn(`[relationPathResolver] Unsupported relation type: ${relationType}`);
    return {
      column: null,
      columnPath: `"${currentAlias}"."${relationName}"`,
      joins: accumulatedJoins,
      finalTable: currentTable,
      finalAlias: currentAlias
    };
  }

  // Add the join to the accumulated joins
  const newJoin: JoinDefinition = {
    table: aliasedTargetTable, // Use aliased table for Drizzle query builder
    tableName: targetTableName,
    alias: targetAlias,
    condition: joinCondition,
    conditionSQL: conditionSQL,
    // Use INNER JOIN for permission checks to ensure related records exist
    // Use LEFT JOIN otherwise to allow optional relations
    type: forPermissionCheck ? 'inner' : 'left'
  };

  const newJoins = [...accumulatedJoins, newJoin];

  // Recursively resolve the remaining segments
  return resolveSegments(
    remainingSegments,
    aliasedTargetTable, // Pass the aliased table for proper column references
    targetTableName,
    targetAlias,
    newJoins,
    forPermissionCheck
  );
}

/**
 * Check if a field path contains relations (has dots)
 */
export function isRelationPath(fieldPath: string): boolean {
  return fieldPath.includes('.');
}

/**
 * Apply joins to a Drizzle query builder
 *
 * Note: Drizzle doesn't support aliasing in joins directly with the leftJoin() API,
 * so we need to use raw SQL for the joins when aliases are needed.
 */
export function applyJoins(baseQuery: any, joins: JoinDefinition[]): any {
  let query = baseQuery;

  // For now, we'll return the joins to be applied as raw SQL in the query builder
  // This is because Drizzle's leftJoin() doesn't support table aliases
  return { query, joins };
}
