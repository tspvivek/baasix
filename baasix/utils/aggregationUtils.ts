/**
 * Aggregation Utilities Module for Drizzle ORM
 * 
 * This module provides aggregation functions (count, sum, avg, min, max)
 * for Drizzle ORM, matching Sequelize aggregation capabilities.
 * 
 * Features:
 * - Standard aggregations (COUNT, SUM, AVG, MIN, MAX)
 * - DISTINCT count
 * - ARRAY_AGG for array aggregation
 * - Date part extraction (YEAR, MONTH, DAY, etc.)
 * - GROUP BY support
 * - Aggregate with relations
 */

import { SQL, sql, count, min, max } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import type {
  AggregateFunction,
  AggregateConfig,
  AggregateMapping,
  AggregateContext,
  DatePart,
  DateTruncPrecision
} from '../types/index.js';

// Re-export types for backward compatibility
export type {
  AggregateFunction,
  AggregateConfig,
  AggregateMapping,
  AggregateContext,
  DatePart,
  DateTruncPrecision
};

/**
 * Simple API Error class
 */
class APIError extends Error {
  statusCode: number;
  
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'APIError';
  }
}

/**
 * Create aggregate function SQL
 * Uses built-in aggregate functions and sql<type> template tags
 */
export function createAggregateFunction(
  func: AggregateFunction,
  column: PgColumn | SQL,
  ctx?: AggregateContext
): SQL {
  switch (func.toLowerCase() as AggregateFunction) {
    case 'max':
      return max(column);

    case 'min':
      return min(column);

    case 'avg':
      // avg() returns string by default in PostgreSQL, use mapWith for number
      return sql<number>`avg(${column})`.mapWith(Number);

    case 'sum':
      // sum() returns string by default in PostgreSQL, use mapWith for number
      return sql<number>`sum(${column})`.mapWith(Number);

    case 'count':
      return count(column);

    case 'distinct':
      return sql<number>`count(distinct ${column})`.mapWith(Number);

    case 'array_agg':
      // Type depends on the column being aggregated
      return sql`array_agg(${column})`;

    default:
      throw new APIError(`Unsupported aggregate function: ${func}`, 400);
  }
}

/**
 * Process date extraction for GROUP BY
 * Format: "date:year:column" -> EXTRACT(YEAR FROM column)
 */
export function processDateExtraction(
  field: string,
  column?: PgColumn | SQL
): {
  expression: SQL;
  alias: string;
} | null {
  const parts = field.split(':');

  if (parts[0] === 'date' && parts.length >= 2) {
    const dateFunction = parts[1];
    const datePart = dateFunction.toUpperCase();

    // If column is provided, use it directly 
    let extractExpression: SQL<number>;
    if (column) {
      extractExpression = sql<number>`extract(${sql.raw(datePart)} from ${column})`.mapWith(Number);
    } else {
      // Quote the column name to preserve case sensitivity
      const columnName = parts[2];
      const quotedColumn = sql.raw(`"${columnName}"`);
      extractExpression = sql<number>`extract(${sql.raw(datePart)} from ${quotedColumn})`.mapWith(Number);
    }

    return {
      expression: extractExpression,
      alias: `${dateFunction}_${parts[2] || 'date'}`
    };
  }

  return null;
}

/**
 * Build aggregate attributes for SELECT clause
 * 
 * @param aggregate - Aggregate mapping (alias -> config)
 * @param groupBy - Array of fields to group by
 * @param ctx - Aggregate context
 * @returns Array of [SQL expression, alias] tuples
 * 
 * @example
 * ```typescript
 * const aggregate = {
 *   totalUsers: { function: 'count', field: 'id' },
 *   avgAge: { function: 'avg', field: 'age' }
 * };
 * 
 * const groupBy = ['status', 'date:year:createdAt'];
 * 
 * const attributes = buildAggregateAttributes(aggregate, groupBy, {
 *   tableName: 'users'
 * });
 * 
 * // Use in query:
 * const results = await db
 *   .select({
 *     ...Object.fromEntries(attributes.map(([expr, alias]) => [alias, expr]))
 *   })
 *   .from(usersTable)
 *   .groupBy(...groupByExprs);
 * ```
 */
export function buildAggregateAttributes(
  aggregate: AggregateMapping,
  groupBy: string[] = [],
  ctx: AggregateContext
): Array<[SQL, string]> {
  const attributes: Array<[SQL, string]> = [];

  // Add aggregate functions
  for (const [alias, aggregateInfo] of Object.entries(aggregate)) {
    const { function: func, field } = aggregateInfo;

    // Convert field string to SQL reference
    let fieldRef: SQL;
    const parts = field.split('.');
    if (parts.length > 1) {
      // Handle relation fields (e.g., "user.type" or "author.posts.price")

      // Check if this is a relation that has been joined
      // First check for exact field match (e.g., "user.id" in map)
      if (ctx.pathToAliasMap && ctx.pathToAliasMap.has(field)) {
        const joinAlias = ctx.pathToAliasMap.get(field)!;
        // The alias is the table alias, append the column name
        const columnName = parts[parts.length - 1];
        fieldRef = sql.raw(`"${joinAlias}"."${columnName}"`);
      } else {
        // Check if just the relation name is in the map (e.g., "user" in map)
        const relationPath = parts[0];
        if (ctx.pathToAliasMap && ctx.pathToAliasMap.has(relationPath)) {
          const joinAlias = ctx.pathToAliasMap.get(relationPath)!;
          // Replace relation name with JOIN alias
          const remainingPath = parts.slice(1);
          const quotedPath = `"${joinAlias}"` + (remainingPath.length > 0 ? '.' + remainingPath.map(p => `"${p}"`).join('.') : '');
          fieldRef = sql.raw(quotedPath);
        } else {
          // No JOIN alias, use field path as-is
          const quotedPath = parts.map(p => `"${p}"`).join('.');
          fieldRef = sql.raw(quotedPath);
        }
      }
    } else {
      // Simple field - add table qualification and quoting
      if (field === '*') {
        // For COUNT(*), don't qualify with table name
        fieldRef = sql.raw('*');
      } else if (ctx.tableName) {
        fieldRef = sql.raw(`"${ctx.tableName}"."${field}"`);
      } else {
        fieldRef = sql.raw(`"${field}"`);
      }
    }

    const expr = createAggregateFunction(func, fieldRef, ctx);
    attributes.push([expr, alias]);
  }
  
  // Add GROUP BY fields
  if (groupBy && groupBy.length > 0) {
    for (const field of groupBy) {
      // Check for date extractions like "date:year:fieldname"
      const dateExtraction = processDateExtraction(field);

      if (dateExtraction) {
        attributes.push([dateExtraction.expression, dateExtraction.alias]);
      } else {
        const parts = field.split('.');

        if (parts.length > 1) {
          // Handle relation fields - use pathToAliasMap for proper JOIN alias
          let fieldRef: SQL;

          // Check if this is a relation that has been joined
          // First check for exact field match (e.g., "user.id" in map)
          if (ctx.pathToAliasMap && ctx.pathToAliasMap.has(field)) {
            const joinAlias = ctx.pathToAliasMap.get(field)!;
            // The alias is the table alias, append the column name
            const columnName = parts[parts.length - 1];
            fieldRef = sql.raw(`"${joinAlias}"."${columnName}"`);
          } else {
            // Check if just the relation name is in the map (e.g., "user" in map)
            const relationPath = parts[0];
            if (ctx.pathToAliasMap && ctx.pathToAliasMap.has(relationPath)) {
              const joinAlias = ctx.pathToAliasMap.get(relationPath)!;
              // Replace relation name with JOIN alias
              const remainingPath = parts.slice(1);
              const quotedPath = `"${joinAlias}"` + (remainingPath.length > 0 ? '.' + remainingPath.map(p => `"${p}"`).join('.') : '');
              fieldRef = sql.raw(quotedPath);
            } else {
              // No JOIN alias, use field path as-is
              fieldRef = sql.raw(`"${parts.join('"."')}"`);
            }
          }

          const alias = field.replace(/\./g, '_');
          attributes.push([fieldRef, alias]);
        } else {
          // Simple field
          const fieldRef = sql.raw(`"${field}"`);
          attributes.push([fieldRef, field]);
        }
      }
    }
  }
  
  return attributes;
}

/**
 * Build GROUP BY expressions using
 *
 * @param groupBy - Array of fields to group by
 * @param columns - Optional map of column objects to use instead of strings
 * @param pathToAliasMap - Optional map of relation paths to JOIN aliases
 * @returns Array of SQL expressions for GROUP BY clause
 */
export function buildGroupByExpressions(
  groupBy: string[],
  columns?: Record<string, PgColumn | SQL>,
  pathToAliasMap?: Map<string, string>
): SQL[] {
  return groupBy.map(field => {
    // Check for date extractions
    const dateExtraction = processDateExtraction(field, columns?.[field]);

    if (dateExtraction) {
      return dateExtraction.expression;
    }

    // If we have a column object, use it directly 
    if (columns?.[field]) {
      return columns[field] as SQL;
    }

    // Handle relation fields - use sql template for identifiers
    const parts = field.split('.');
    if (parts.length > 1) {
      // Check if this is a relation that has been joined
      // First check for exact field match (e.g., "user.id" in map)
      if (pathToAliasMap && pathToAliasMap.has(field)) {
        const joinAlias = pathToAliasMap.get(field)!;
        // The alias is the table alias, append the column name
        const columnName = parts[parts.length - 1];
        return sql.raw(`"${joinAlias}"."${columnName}"`);
      }

      // Check if just the relation name is in the map (e.g., "user" in map)
      const relationPath = parts[0];
      if (pathToAliasMap && pathToAliasMap.has(relationPath)) {
        const joinAlias = pathToAliasMap.get(relationPath)!;
        // Replace relation name with JOIN alias
        const remainingPath = parts.slice(1);
        const quotedPath = `"${joinAlias}"` + (remainingPath.length > 0 ? '.' + remainingPath.map(p => `"${p}"`).join('.') : '');
        return sql.raw(quotedPath);
      }

      // No JOIN alias, use field path as-is
      const quotedPath = parts.map(p => `"${p}"`).join('.');
      return sql.raw(quotedPath);
    }

    // Simple field - use sql template
    return sql.raw(`"${field}"`);
  });
}

/**
 * Count records with optional distinct
 * 
 * @param column - Column to count (or '*' for all)
 * @param distinct - Whether to count distinct values only
 */
export function countRecords(column?: PgColumn | SQL, distinct: boolean = false): SQL {
  if (!column) {
    return sql`COUNT(*)`;
  }
  
  if (distinct) {
    return sql`COUNT(DISTINCT ${column})`;
  }
  
  return sql`COUNT(${column})`;
}

/**
 * Sum column values
 */
export function sumColumn(column: PgColumn | SQL): SQL {
  return sql`SUM(${column})`;
}

/**
 * Average column values
 */
export function avgColumn(column: PgColumn | SQL): SQL {
  return sql`AVG(${column})`;
}

/**
 * Minimum column value
 */
export function minColumn(column: PgColumn | SQL): SQL {
  return sql`MIN(${column})`;
}

/**
 * Maximum column value
 */
export function maxColumn(column: PgColumn | SQL): SQL {
  return sql`MAX(${column})`;
}

/**
 * Array aggregation (collect values into array)
 */
export function arrayAgg(column: PgColumn | SQL, distinct: boolean = false): SQL {
  if (distinct) {
    return sql`ARRAY_AGG(DISTINCT ${column})`;
  }
  
  return sql`ARRAY_AGG(${column})`;
}

/**
 * String aggregation (concatenate values)
 */
export function stringAgg(column: PgColumn | SQL, delimiter: string = ', '): SQL {
  return sql`STRING_AGG(${column}, ${delimiter})`;
}

/**
 * JSON aggregation (collect rows as JSON array)
 */
export function jsonAgg(rowExpression: SQL): SQL {
  return sql`JSON_AGG(${rowExpression})`;
}

/**
 * Date part extraction using
 *
 * @param part - Date part to extract (year, month, day, hour, minute, week, dow, isodow)
 * @param column - Date/timestamp column
 * @example
 * const yearCol = extractDatePart('year', users.createdAt);
 * // Equivalent to: EXTRACT(YEAR FROM users.createdAt)
 */
export function extractDatePart(part: DatePart, column: PgColumn | SQL): SQL<number> {
  const partUpper = part.toUpperCase();
  // Use sql<number> for type safety and .mapWith(Number) for runtime conversion
  return sql<number>`extract(${sql.raw(partUpper)} from ${column})`.mapWith(Number);
}

/**
 * Date truncation
 *
 * @param precision - Time precision (day, week, month, year, hour, minute)
 * @param column - Date/timestamp column
 * @example
 * const dailyGroups = truncateDate('day', orders.createdAt);
 * // Equivalent to: DATE_TRUNC('day', orders.createdAt)
 */
export function truncateDate(precision: DateTruncPrecision, column: PgColumn | SQL): SQL<Date> {
  // Use sql<Date> for type safety - returns timestamp
  return sql<Date>`date_trunc(${precision}, ${column})`;
}

/**
 * Conditional count (COUNT with CASE WHEN)
 * 
 * @example
 * ```typescript
 * // Count active users
 * const activeCount = conditionalCount(
 *   eq(usersTable.status, 'active')
 * );
 * ```
 */
export function conditionalCount(condition: SQL): SQL {
  return sql`COUNT(CASE WHEN ${condition} THEN 1 END)`;
}

/**
 * Conditional sum (SUM with CASE WHEN)
 */
export function conditionalSum(column: PgColumn | SQL, condition: SQL): SQL {
  return sql`SUM(CASE WHEN ${condition} THEN ${column} ELSE 0 END)`;
}

/**
 * Percentile calculation
 *
 * @param column - Numeric column
 * @param percentile - Percentile value (0.0 to 1.0)
 * @param discrete - Use discrete (percentile_disc) vs continuous (percentile_cont)
 * @example
 * const median = calculatePercentile(sales.amount, 0.5);
 * // Equivalent to: PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sales.amount)
 */
export function calculatePercentile(
  column: PgColumn | SQL,
  percentile: number,
  discrete: boolean = false
): SQL<number> {
  const func = discrete ? 'percentile_disc' : 'percentile_cont';
  return sql<number>`${sql.raw(func)}(${percentile}) within group (order by ${column})`.mapWith(Number);
}

/**
 * Standard deviation
 */
export function stddev(column: PgColumn | SQL, population: boolean = false): SQL<number> {
  const func = population ? 'stddev_pop' : 'stddev_samp';
  return sql<number>`${sql.raw(func)}(${column})`.mapWith(Number);
}

/**
 * Variance
 */
export function variance(column: PgColumn | SQL, population: boolean = false): SQL<number> {
  const func = population ? 'var_pop' : 'var_samp';
  return sql<number>`${sql.raw(func)}(${column})`.mapWith(Number);
}

/**
 * Coalesce (return first non-null value)
 */
export function coalesce(...values: Array<PgColumn | SQL | any>): SQL {
  const valueParts = values.map(v => 
    v && typeof v === 'object' && 'queryChunks' in v ? v : sql.raw(String(v))
  );
  
  return sql`COALESCE(${sql.join(valueParts, sql`, `)})`;
}

/**
 * Full-text search matching
 * @param columns - Array of column objects to search
 * @param searchQuery - Search query string
 * @returns SQL condition for full-text matching
 */
export function applyFullTextSearch(
  columns: Array<PgColumn | SQL>,
  searchQuery: string
): SQL<boolean> {
  // Prepare the full-text search query
  const tsQuery = searchQuery.trim().replace(/\s+/g, ":* & ") + ":*";
  const escapedTsQuery = tsQuery.replace(/'/g, "''");

  // Build concatenated fields using sql template
  const concatParts = columns.map(col => sql`coalesce(${col}::text, '')`);
  const concatFields = sql.join(concatParts, sql` || ' ' || `);

  // Use sql<boolean> for the comparison result
  return sql<boolean>`to_tsvector('english', ${concatFields}) @@ to_tsquery('english', ${escapedTsQuery})`;
}

/**
 * Geographic distance calculation
 *
 * @param column - Geography/geometry column
 * @param targetPoint - GeoJSON point
 * @returns SQL for distance in meters
 */
export function calculateDistance(
  column: PgColumn | SQL,
  targetPoint: { type: string; coordinates: [number, number] }
): SQL<number> {
  const geoJSON = JSON.stringify(targetPoint);
  // Use ST_DistanceSpheroid for accurate earth-surface distance in meters
  // This is more reliable than ::geography casting across different PostGIS versions
  return sql<number>`ST_DistanceSpheroid(
    ${column},
    ST_SetSRID(ST_GeomFromGeoJSON(${geoJSON}), 4326),
    'SPHEROID["WGS 84",6378137,298.257223563]'
  )`.mapWith(Number);
}

/**
 * Build HAVING clause from filter
 * Similar to WHERE but for aggregate results
 *
 * Note: HAVING clause is not currently used in the application.
 * This is a placeholder for future implementation if aggregate filtering is needed.
 */
export function buildHavingClause(filter: Record<string, any>): SQL | undefined {
  // HAVING clause would use similar logic to drizzleWhere but for aggregate columns
  // Currently not implemented as no use cases require it
  if (!filter || Object.keys(filter).length === 0) {
    return undefined;
  }

  // Not implemented - would require building conditions for aggregate expressions
  // Example: HAVING COUNT(*) > 5, HAVING SUM(amount) >= 100
  return undefined;
}
