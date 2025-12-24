/**
 * Order/Sort Utilities Module for Drizzle ORM
 * 
 * This module provides sorting utilities that convert Sequelize-style
 * sort objects into Drizzle ORM orderBy clauses.
 * 
 * Features:
 * - Convert sort objects to Drizzle orderBy
 * - Support ascending/descending sort
 * - Handle nested relation sorting
 * - Support special fields (aggregate functions, computed columns)
 * - Full-text search relevance ranking
 */

import { SQL, sql, asc, desc } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { SortDirection, SortObject, SortContext } from '../types/index.js';

// Re-export types for backward compatibility
export type { SortDirection, SortObject, SortContext };

/**
 * Process a single sort field
 * Handles both simple fields and complex nested relation paths
 */
function processSortField(
  fieldPath: string,
  direction: SortDirection,
  ctx: SortContext
): SQL {
  const normalizedDirection = direction.toUpperCase() as 'ASC' | 'DESC';

  // Handle nested relation paths
  if (fieldPath.includes('.')) {
    const parts = fieldPath.split('.');

    // For nested relation paths (e.g., "userRoles.role.name" or "author.name"),
    // the table alias is the SECOND-TO-LAST part (the immediate parent relation),
    // and the column is the LAST part.
    //
    // Example: "userRoles.role.name"
    //   - userRoles is aliased as "userRoles" (HasMany JOIN)
    //   - role is aliased as "role" (BelongsTo nested JOIN under userRoles)
    //   - We ORDER BY "role"."name"
    //
    // Example: "author.name"
    //   - author is aliased as "author"
    //   - We ORDER BY "author"."name"
    const relationName = parts[parts.length - 2]; // Second-to-last part is the table alias
    const columnName = parts[parts.length - 1];  // Last part is the column

    const sqlColumn = sql.raw(`"${relationName}"."${columnName}"`);
    return normalizedDirection === 'ASC' ? asc(sqlColumn) : desc(sqlColumn);
  }

  // Direct field - check if it exists in schema
  if (ctx.schema && ctx.schema[fieldPath]) {
    const column = ctx.schema[fieldPath];
    return normalizedDirection === 'ASC' ? asc(column) : desc(column);
  }

  // Fallback to raw SQL for computed/aggregate fields
  const sqlColumn = ctx.tableName
    ? sql.raw(`"${ctx.tableName}"."${fieldPath}"`)
    : sql.raw(`"${fieldPath}"`);

  return normalizedDirection === 'ASC' ? asc(sqlColumn) : desc(sqlColumn);
}

/**
 * Convert Sequelize-style sort object to Drizzle orderBy array
 * 
 * @param sort - Sort object or JSON string
 * @param ctx - Sort context with table schema
 * @returns Array of Drizzle orderBy SQL expressions
 * 
 * @example
 * ```typescript
 * const sort = { name: 'ASC', createdAt: 'DESC' };
 * 
 * const orderBy = drizzleOrder(sort, {
 *   table: usersTable,
 *   tableName: 'users',
 *   schema: usersTable
 * });
 * 
 * // Use in query:
 * const results = await db.select().from(usersTable).orderBy(...orderBy);
 * ```
 */
export function drizzleOrder(
  sort: SortObject | string | null | undefined,
  ctx: SortContext
): SQL[] {
  if (!sort) return [];

  // Parse JSON string if needed
  let sortObject: SortObject;
  if (typeof sort === 'string') {
    try {
      sortObject = JSON.parse(sort);
    } catch (e) {
      console.warn('Failed to parse sort string:', e);
      return [];
    }
  } else {
    sortObject = sort;
  }

  // Convert each sort field to Drizzle orderBy
  return Object.entries(sortObject).map(([field, direction]) => {
    // Handle special _distance sorting
    if (field === '_distance' && typeof direction === 'object') {
      const distanceConfig = direction as any;
      const { target, column, direction: sortDir } = distanceConfig;

      // Build qualified field name
      let fieldRef: string;
      if (column.startsWith('"')) {
        fieldRef = column;
      } else if (column.includes('.')) {
        const [table, col] = column.split('.');
        fieldRef = `"${table}"."${col}"`;
      } else if (ctx.tableName) {
        fieldRef = `"${ctx.tableName}"."${column}"`;
      } else {
        fieldRef = `"${column}"`;
      }

      return sortByDistance(
        fieldRef,
        { type: 'Point', coordinates: target },
        sortDir as SortDirection
      );
    }

    return processSortField(field, direction as SortDirection, ctx);
  });
}

/**
 * Apply full-text search ranking to sort
 * Used for relevance-based sorting when searching
 *
 * @param searchFields - Fields to search in
 * @param searchQuery - Search query string
 * @param ctx - Sort context
 * @returns SQL for ts_rank ordering
 */
export function applyFullTextSearchRanking(
  searchFields: string[],
  searchQuery: string,
  ctx: SortContext
): SQL {
  const tableName = ctx.tableName || 'table';

  // Create concatenated string of all searchable fields using sql template
  const fieldParts = searchFields.map(field =>
    sql`COALESCE(${sql.raw(`"${tableName}"."${field}"`)}::text, '')`
  );
  const concatFields = sql.join(fieldParts, sql` || ' ' || `);

  // Prepare the full-text search query (escape single quotes)
  const tsQuery = searchQuery.trim().replace(/\s+/g, ":* & ") + ":*";
  const escapedTsQuery = tsQuery.replace(/'/g, "''");

  // Build ts_rank expression using sql template
  const rankSQL = sql`ts_rank(to_tsvector('english', ${concatFields}), to_tsquery('english', ${escapedTsQuery}))`;

  return desc(rankSQL);
}

/**
 * Sort by aggregate function result
 * Example: Sort by count of related records
 */
export function sortByAggregate(
  aggregateExpression: SQL,
  direction: SortDirection = 'DESC'
): SQL {
  const normalizedDirection = direction.toUpperCase() as 'ASC' | 'DESC';
  return normalizedDirection === 'ASC' ? asc(aggregateExpression) : desc(aggregateExpression);
}

/**
 * Sort by distance (for geo queries)
 *
 * @param fieldName - The geometry/geography field name
 * @param referencePoint - GeoJSON point to measure distance from
 * @param direction - Sort direction (usually ASC for nearest first)
 */
export function sortByDistance(
  fieldName: string,
  referencePoint: { type: string; coordinates: [number, number] },
  direction: SortDirection = 'ASC'
): SQL {
  const geoJSON = JSON.stringify(referencePoint);
  // Use ST_DistanceSpheroid for accurate earth-surface distance calculations in meters
  // This is more reliable than ::geography casting across different PostGIS versions
  const spheroid = `SPHEROID["WGS 84",6378137,298.257223563]`;
  const distanceSQL = sql`ST_DistanceSpheroid(${sql.raw(fieldName)}, ST_SetSRID(ST_GeomFromGeoJSON(${geoJSON}), 4326), ${spheroid})`;

  const normalizedDirection = direction.toUpperCase() as 'ASC' | 'DESC';
  return normalizedDirection === 'ASC' ? asc(distanceSQL) : desc(distanceSQL);
}

/**
 * Sort by CASE expression (conditional sorting)
 * Useful for custom sort orders
 *
 * @example
 * ```typescript
 * // Sort by status: active first, then pending, then inactive
 * const sortExpr = sortByCase({
 *   field: 'status',
 *   cases: [
 *     { when: 'active', then: 1 },
 *     { when: 'pending', then: 2 },
 *     { when: 'inactive', then: 3 }
 *   ],
 *   direction: 'ASC'
 * });
 * ```
 */
export function sortByCase(options: {
  field: string;
  cases: Array<{ when: any; then: number }>;
  direction?: SortDirection;
  defaultValue?: number;
}): SQL {
  const { field, cases, direction = 'ASC', defaultValue = 999 } = options;

  // Build CASE expression using sql template with parameterized values
  const caseParts = cases.map(c =>
    sql`WHEN ${sql.raw(`"${field}"`)} = ${c.when} THEN ${c.then}`
  );

  const caseSQL = sql`CASE ${sql.join(caseParts, sql` `)} ELSE ${defaultValue} END`;

  const normalizedDirection = direction.toUpperCase() as 'ASC' | 'DESC';
  return normalizedDirection === 'ASC' ? asc(caseSQL) : desc(caseSQL);
}

/**
 * Sort nulls first or last
 * PostgreSQL default: ASC puts nulls last, DESC puts nulls first
 * This function allows explicit control
 */
export function sortWithNulls(
  column: PgColumn,
  direction: SortDirection = 'ASC',
  nullsFirst: boolean = false
): SQL {
  const normalizedDirection = direction.toUpperCase() as 'ASC' | 'DESC';

  const baseSort = normalizedDirection === 'ASC' ? asc(column) : desc(column);

  // Use sql literals instead of sql.raw for keywords
  if (nullsFirst) {
    return sql`${baseSort} NULLS FIRST`;
  } else {
    return sql`${baseSort} NULLS LAST`;
  }
}

/**
 * Parse sort string formats
 * Supports various input formats:
 * - "name" -> { name: 'ASC' }
 * - "-name" -> { name: 'DESC' }
 * - "name,createdAt" -> { name: 'ASC', createdAt: 'ASC' }
 * - "-name,createdAt" -> { name: 'DESC', createdAt: 'ASC' }
 */
export function parseSortString(sortStr: string): SortObject {
  if (!sortStr || sortStr.trim() === '') return {};
  
  const result: SortObject = {};
  
  const fields = sortStr.split(',').map(f => f.trim());
  
  for (const field of fields) {
    if (field.startsWith('-')) {
      // Descending
      result[field.substring(1)] = 'DESC';
    } else {
      // Ascending
      result[field] = 'ASC';
    }
  }
  
  return result;
}

/**
 * Combine multiple sort criteria
 * Earlier criteria take precedence
 */
export function combineSorts(...sorts: (SortObject | null | undefined)[]): SortObject {
  const result: SortObject = {};
  
  // Process in reverse order so earlier sorts override later ones
  for (let i = sorts.length - 1; i >= 0; i--) {
    const sort = sorts[i];
    if (sort) {
      Object.assign(result, sort);
    }
  }
  
  return result;
}

/**
 * Default sort (by ID descending for most recent first)
 */
export function defaultSort(ctx: SortContext): SQL[] {
  return drizzleOrder({ id: 'DESC' }, ctx);
}
