/**
 * Filter Operators Module for Drizzle ORM
 * 
 * This module provides a comprehensive set of filter operators that map
 * Sequelize-style filter syntax to Drizzle ORM where conditions.
 * 
 * Supports:
 * - Basic comparison operators (eq, ne, gt, lt, gte, lte)
 * - String pattern matching (like, ilike, startsWith, endsWith)
 * - Collection operators (in, notIn)
 * - Range operators (between, notBetween)
 * - Null checks (isNull, isNotNull)
 * - Array operators (arraycontains, arraycontained)
 * - JSONB operators (jsonbContains, jsonbHasKey, jsonbPathExists, etc.)
 * - Geo/spatial operators (within, contains, intersects, dwithin)
 * - Column-to-column comparisons with $COL() syntax
 * - Type casting with PostgreSQL :: syntax
 */

import {
  eq, ne, gt, gte, lt, lte,
  isNull, isNotNull,
  inArray, notInArray,
  between, notBetween,
  like, ilike, notLike, notIlike,
  and, or, not,
  sql,
  SQL
} from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import type { ColumnReference, FilterValue, OperatorContext } from '../types/index.js';

// Re-export types for backward compatibility
export type { ColumnReference, FilterValue, OperatorContext };

/**
 * Valid PostgreSQL cast types to prevent SQL injection
 */
const VALID_CAST_TYPES = [
  'text', 'varchar', 'char', 'character',
  'integer', 'int', 'bigint', 'smallint',
  'decimal', 'numeric', 'real', 'double precision', 'float',
  'boolean', 'bool',
  'date', 'timestamp', 'timestamptz', 'time', 'timetz',
  'uuid', 'json', 'jsonb',
  'text[]', 'varchar[]', 'integer[]', 'bigint[]', 'uuid[]'
];

/**
 * Validate PostgreSQL cast type to prevent SQL injection
 */
function validateCastType(castType: string | undefined): string | null {
  if (!castType) return null;

  const normalizedType = castType.toLowerCase().trim();
  if (VALID_CAST_TYPES.includes(normalizedType)) {
    return normalizedType;
  }

  // Invalid cast types are silently ignored (return null to skip casting)
  console.warn(`Invalid cast type "${castType}" will be ignored. Allowed types: ${VALID_CAST_TYPES.join(', ')}`);
  return null;
}

/**
 * Check if a value is a column reference
 * Format: $COL(columnName) or $COL(tableName.columnName)
 */
export function isColumnReference(value: any): value is ColumnReference {
  return typeof value === 'string' && value.startsWith('$COL(') && value.endsWith(')');
}

/**
 * Extract column name/path from column reference
 */
export function extractColumnFromReference(value: ColumnReference): string {
  return value.slice(5, -1); // Remove '$COL(' and ')'
}

/**
 * Parse PostgreSQL casting syntax from column reference
 * Example: "columnName::text" -> { columnPath: "columnName", castType: "text" }
 */
export function parseColumnCastSyntax(columnPath: string): { columnPath: string; castType: string | null } {
  const castMatch = columnPath.match(/^(.+)::(.+)$/);
  if (castMatch) {
    return {
      columnPath: castMatch[1],
      castType: castMatch[2]
    };
  }
  return {
    columnPath,
    castType: null
  };
}

/**
 * Build SQL identifier for column with optional casting
 */
export function buildColumnSQL(columnPath: string, castType?: string | null): SQL {
  const validated = validateCastType(castType || undefined);

  // Check if columnPath is already quoted (e.g., from resolveRelationPath)
  // Format: "alias"."column" or "column"
  if (columnPath.startsWith('"')) {
    // Already quoted, use as-is without nesting sql templates
    return validated ? sql.raw(`CAST(${columnPath} AS ${validated.toUpperCase()})`) : sql.raw(columnPath);
  }

  if (columnPath.includes('.')) {
    const [tableName, columnName] = columnPath.split('.');
    const quotedPath = `"${tableName}"."${columnName}"`;
    return validated ? sql.raw(`CAST(${quotedPath} AS ${validated.toUpperCase()})`) : sql.raw(quotedPath);
  }

  const quotedPath = `"${columnPath}"`;
  return validated ? sql.raw(`CAST(${quotedPath} AS ${validated.toUpperCase()})`) : sql.raw(quotedPath);
}

/**
 * Build raw SQL string for column identifier (without wrapping in SQL object)
 * Used when we need to build a completely raw SQL expression
 */
function buildColumnSQLString(columnPath: string, castType?: string | null): string {
  const validated = validateCastType(castType || undefined);

  // Check if columnPath is already quoted (e.g., from resolveRelationPath)
  // Format: "alias"."column" or "column"
  let quotedPath: string;
  if (columnPath.startsWith('"')) {
    // Already quoted, use as-is
    quotedPath = columnPath;
  } else if (columnPath.includes('.')) {
    const [tableName, columnName] = columnPath.split('.');
    quotedPath = `"${tableName}"."${columnName}"`;
  } else {
    quotedPath = `"${columnPath}"`;
  }

  return validated ? `CAST(${quotedPath} AS ${validated.toUpperCase()})` : quotedPath;
}

/**
 * Safely escape SQL string values
 */
function escapeSqlValue(value: any): string {
  return String(value).replace(/'/g, "''");
}

/**
 * Convert a value to a raw SQL string literal for use in filter operations
 * Handles dates, strings, and numbers appropriately
 */
function valueToRawSQL(value: any): string {
  console.log(`[valueToRawSQL] Input value:`, value, `Type:`, typeof value);
  if (typeof value === 'string') {
    // Check if it's a date-like string (YYYY-MM-DD or ISO format)
    const datePattern = /^\d{4}-\d{2}-\d{2}/;
    if (datePattern.test(value)) {
      const dateObj = new Date(value);
      if (!isNaN(dateObj.getTime())) {
        const result = `'${dateObj.toISOString()}'`;
        console.log(`[valueToRawSQL] Date string converted:`, result);
        return result;
      }
    }
    // Regular string - escape and quote
    const result = `'${value.replace(/'/g, "''")}'`;
    console.log(`[valueToRawSQL] String escaped:`, result);
    return result;
  } else if (value instanceof Date) {
    const result = `'${value.toISOString()}'`;
    console.log(`[valueToRawSQL] Date object converted:`, result);
    return result;
  } else {
    // Numbers and other types - no quotes
    const result = String(value);
    console.log(`[valueToRawSQL] Number/other:`, result);
    return result;
  }
}

/**
 * Normalize date values - convert datetime strings to Date objects
 * Keep date-only strings (YYYY-MM-DD) as strings for Date type columns
 * Convert datetime strings (YYYY-MM-DDTHH:MM:SS) to Date objects for DateTime/Timestamp columns
 */
function normalizeDateValue(value: any): any {
  // If already a Date, return as-is
  if (value instanceof Date) {
    return value;
  }

  // If it's a string that looks like a datetime (has time component), convert to Date
  if (typeof value === 'string') {
    // Check if it's a full datetime string (has time component)
    const datetimePattern = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/;
    if (datetimePattern.test(value)) {
      const parsedDate = new Date(value);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate;
      }
    }

    // For date-only strings (YYYY-MM-DD), keep as string
    // This is needed for Date type columns which expect strings, not Date objects
  }

  // Return as-is for other types (including date-only strings)
  return value;
}

/**
 * Format array values based on PostgreSQL element type
 */
function formatArrayForPostgreSQL(value: any | any[], elementType: string): string {
  const arrayValue = Array.isArray(value) ? value : [value];
  
  switch (elementType.toLowerCase()) {
    case 'integer':
    case 'bigint':
      return `ARRAY[${arrayValue.map(v => parseInt(String(v)) || 0).join(',')}]`;
      
    case 'decimal':
    case 'numeric':
    case 'real':
    case 'double precision':
      return `ARRAY[${arrayValue.map(v => parseFloat(String(v)) || 0).join(',')}]`;
      
    case 'boolean':
      return `ARRAY[${arrayValue.map(v => Boolean(v)).join(',')}]`;
      
    case 'uuid':
      return `ARRAY[${arrayValue.map(v => `'${escapeSqlValue(v)}'`).join(',')}]::uuid[]`;
      
    case 'date':
    case 'dateonly':
    case 'time':
      return `ARRAY[${arrayValue.map(v => `'${escapeSqlValue(v)}'`).join(',')}]::${elementType}[]`;
      
    case 'string':
    case 'text':
    case 'varchar':
    default:
      return `ARRAY[${arrayValue.map(v => `'${escapeSqlValue(v)}'`).join(',')}]::text[]`;
  }
}

/**
 * Operator: Equality (eq)
 * Example: { age: { eq: 25 } } -> age = 25
 */
export function eqOperator(ctx: OperatorContext, value: FilterValue, castType?: string): SQL {
  if (isColumnReference(value)) {
    const rightCol = extractColumnFromReference(value);
    const { columnPath, castType: rightCast } = parseColumnCastSyntax(rightCol);
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const rightSQL = buildColumnSQL(columnPath, rightCast || castType);
    return sql`${leftSQL} = ${rightSQL}`;
  }

  // Normalize date values (convert string dates to Date objects)
  const normalizedValue = normalizeDateValue(value);

  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    // Build the entire expression as raw SQL to completely bypass Drizzle's type mappers
    const leftSQL = buildColumnSQLString(ctx.fieldName, castType);
    const rightSQL = valueToRawSQL(normalizedValue);
    return sql.raw(`${leftSQL} = ${rightSQL}`);
  }

  // For Drizzle operators, keep as Date object (Drizzle's column mappers expect Date objects)
  return eq(ctx.column, normalizedValue);
}

/**
 * Operator: Not Equal (ne)
 * Example: { status: { ne: 'inactive' } } -> status != 'inactive'
 * Example: { contract_number: { ne: null } } -> contract_number IS NOT NULL
 */
export function neOperator(ctx: OperatorContext, value: FilterValue, castType?: string): SQL {
  if (isColumnReference(value)) {
    const rightCol = extractColumnFromReference(value);
    const { columnPath, castType: rightCast } = parseColumnCastSyntax(rightCol);
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const rightSQL = buildColumnSQL(columnPath, rightCast || castType);
    return sql`${leftSQL} != ${rightSQL}`;
  }

  // Special handling for null values - must use IS NOT NULL syntax
  if (value === null) {
    if (castType || ctx.tableName) {
      const leftSQL = buildColumnSQL(ctx.fieldName, castType);
      return sql`${leftSQL} IS NOT NULL`;
    }
    return isNotNull(ctx.column);
  }

  // Normalize date values (convert string dates to Date objects)
  const normalizedValue = normalizeDateValue(value);

  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    // Build the entire expression as raw SQL to completely bypass Drizzle's type mappers
    const leftSQL = buildColumnSQLString(ctx.fieldName, castType);
    const rightSQL = valueToRawSQL(normalizedValue);
    return sql.raw(`${leftSQL} != ${rightSQL}`);
  }

  // For Drizzle operators, keep as Date object (Drizzle's column mappers expect Date objects)
  return ne(ctx.column, normalizedValue);
}

/**
 * Operator: Greater Than (gt)
 * Example: { age: { gt: 18 } } -> age > 18
 */
export function gtOperator(ctx: OperatorContext, value: FilterValue, castType?: string): SQL {
  if (isColumnReference(value)) {
    const rightCol = extractColumnFromReference(value);
    const { columnPath, castType: rightCast } = parseColumnCastSyntax(rightCol);
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const rightSQL = buildColumnSQL(columnPath, rightCast || castType);
    return sql`${leftSQL} > ${rightSQL}`;
  }

  // Normalize date values (convert string dates to Date objects)
  const normalizedValue = normalizeDateValue(value);

  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    // Build the entire expression as raw SQL to completely bypass Drizzle's type mappers
    const leftSQL = buildColumnSQLString(ctx.fieldName, castType);
    const rightSQL = valueToRawSQL(normalizedValue);
    return sql.raw(`${leftSQL} > ${rightSQL}`);
  }

  // For Drizzle operators, keep as Date object (Drizzle's column mappers expect Date objects)
  return gt(ctx.column, normalizedValue);
}

/**
 * Operator: Greater Than or Equal (gte)
 * Example: { age: { gte: 18 } } -> age >= 18
 */
export function gteOperator(ctx: OperatorContext, value: FilterValue, castType?: string): SQL {
  if (isColumnReference(value)) {
    const rightCol = extractColumnFromReference(value);
    const { columnPath, castType: rightCast } = parseColumnCastSyntax(rightCol);
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const rightSQL = buildColumnSQL(columnPath, rightCast || castType);
    return sql`${leftSQL} >= ${rightSQL}`;
  }

  // Normalize date values (convert string dates to Date objects)
  const normalizedValue = normalizeDateValue(value);

  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    // Build the entire expression as raw SQL to completely bypass Drizzle's type mappers
    const leftSQL = buildColumnSQLString(ctx.fieldName, castType);
    const rightSQL = valueToRawSQL(normalizedValue);
    return sql.raw(`${leftSQL} >= ${rightSQL}`);
  }

  // For Drizzle operators, keep as Date object (Drizzle's column mappers expect Date objects)
  return gte(ctx.column, normalizedValue);
}

/**
 * Operator: Less Than (lt)
 * Example: { age: { lt: 65 } } -> age < 65
 */
export function ltOperator(ctx: OperatorContext, value: FilterValue, castType?: string): SQL {
  if (isColumnReference(value)) {
    const rightCol = extractColumnFromReference(value);
    const { columnPath, castType: rightCast } = parseColumnCastSyntax(rightCol);
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const rightSQL = buildColumnSQL(columnPath, rightCast || castType);
    return sql`${leftSQL} < ${rightSQL}`;
  }

  // Normalize date values (convert string dates to Date objects)
  const normalizedValue = normalizeDateValue(value);

  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    // Build the entire expression as raw SQL to completely bypass Drizzle's type mappers
    const leftSQL = buildColumnSQLString(ctx.fieldName, castType);
    const rightSQL = valueToRawSQL(normalizedValue);
    return sql.raw(`${leftSQL} < ${rightSQL}`);
  }

  // For Drizzle operators, keep as Date object (Drizzle's column mappers expect Date objects)
  return lt(ctx.column, normalizedValue);
}

/**
 * Operator: Less Than or Equal (lte)
 * Example: { age: { lte: 65 } } -> age <= 65
 */
export function lteOperator(ctx: OperatorContext, value: FilterValue, castType?: string): SQL {
  if (isColumnReference(value)) {
    const rightCol = extractColumnFromReference(value);
    const { columnPath, castType: rightCast } = parseColumnCastSyntax(rightCol);
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const rightSQL = buildColumnSQL(columnPath, rightCast || castType);
    return sql`${leftSQL} <= ${rightSQL}`;
  }

  // Normalize date values (convert string dates to Date objects)
  const normalizedValue = normalizeDateValue(value);

  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    // Build the entire expression as raw SQL to completely bypass Drizzle's type mappers
    const leftSQL = buildColumnSQLString(ctx.fieldName, castType);
    const rightSQL = valueToRawSQL(normalizedValue);
    return sql.raw(`${leftSQL} <= ${rightSQL}`);
  }

  // For Drizzle operators, keep as Date object (Drizzle's column mappers expect Date objects)
  return lte(ctx.column, normalizedValue);
}

/**
 * Operator: LIKE (case-sensitive pattern matching)
 * Example: { name: { like: 'John' } } -> name LIKE '%John%'
 */
export function likeOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} LIKE ${'%' + escapeSqlValue(value) + '%'}`;
  }

  return like(ctx.column, `%${value}%`);
}

/**
 * Operator: NOT LIKE (case-sensitive pattern non-matching)
 */
export function notLikeOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} NOT LIKE ${'%' + escapeSqlValue(value) + '%'}`;
  }
  
  return notLike(ctx.column, `%${value}%`);
}

/**
 * Operator: ILIKE (case-insensitive pattern matching)
 * Example: { name: { iLike: 'john' } } -> name ILIKE '%john%'
 */
export function iLikeOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} ILIKE ${'%' + escapeSqlValue(value) + '%'}`;
  }
  
  return ilike(ctx.column, `%${value}%`);
}

/**
 * Operator: NOT ILIKE (case-insensitive pattern non-matching)
 */
export function notILikeOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} NOT ILIKE ${'%' + escapeSqlValue(value) + '%'}`;
  }
  
  return notIlike(ctx.column, `%${value}%`);
}

/**
 * Operator: Starts With (case-insensitive)
 * Example: { name: { startsWith: 'John' } } -> name ILIKE 'John%'
 */
export function startsWithOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} ILIKE ${escapeSqlValue(value) + '%'}`;
  }
  
  return ilike(ctx.column, `${value}%`);
}

/**
 * Operator: Starts With Case-Sensitive (startsWiths)
 */
export function startsWithsOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} LIKE ${escapeSqlValue(value) + '%'}`;
  }
  
  return like(ctx.column, `${value}%`);
}

/**
 * Operator: Ends With (case-insensitive)
 * Example: { name: { endsWith: 'son' } } -> name ILIKE '%son'
 */
export function endsWithOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} ILIKE ${'%' + escapeSqlValue(value)}`;
  }
  
  return ilike(ctx.column, `%${value}`);
}

/**
 * Operator: Ends With Case-Sensitive (endsWiths)
 */
export function endsWithsOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} LIKE ${'%' + escapeSqlValue(value)}`;
  }
  
  return like(ctx.column, `%${value}`);
}

/**
 * Operator: Not Starts With (case-insensitive)
 */
export function nstartsWithOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} NOT ILIKE ${escapeSqlValue(value) + '%'}`;
  }
  
  return notIlike(ctx.column, `${value}%`);
}

/**
 * Operator: Not Starts With Case-Sensitive
 */
export function nstartsWithsOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} NOT LIKE ${escapeSqlValue(value) + '%'}`;
  }
  
  return notLike(ctx.column, `${value}%`);
}

/**
 * Operator: Not Ends With (case-insensitive)
 */
export function nendsWithOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} NOT ILIKE ${'%' + escapeSqlValue(value)}`;
  }
  
  return notIlike(ctx.column, `%${value}`);
}

/**
 * Operator: Not Ends With Case-Sensitive
 */
export function nendsWithsOperator(ctx: OperatorContext, value: string, castType?: string): SQL {
  if (castType) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} NOT LIKE ${'%' + escapeSqlValue(value)}`;
  }
  
  return notLike(ctx.column, `%${value}`);
}

/**
 * Operator: IN (value in array)
 * Example: { status: { in: ['active', 'pending'] } }
 */
export function inOperator(ctx: OperatorContext, value: any[], castType?: string): SQL {
  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    // Use parameterized values instead of manual escaping
    const placeholders = value.map(() => sql.raw('?')).join(', ');
    return sql`${leftSQL} IN (${sql.join(value.map(v => sql`${v}`), sql`, `)})`;
  }

  return inArray(ctx.column, value || []);
}

/**
 * Operator: NOT IN (value not in array)
 * Example: { status: { notIn: ['deleted', 'archived'] } }
 */
export function notInOperator(ctx: OperatorContext, value: any[], castType?: string): SQL {
  // Use buildColumnSQL if we have a tableName (alias) or castType to ensure proper aliasing
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    // Use parameterized values instead of manual escaping
    return sql`${leftSQL} NOT IN (${sql.join(value.map(v => sql`${v}`), sql`, `)})`;
  }

  return notInArray(ctx.column, value || []);
}

/**
 * Operator: BETWEEN (value in range)
 * Example: { age: { between: [18, 65] } } -> age BETWEEN 18 AND 65
 */
export function betweenOperator(ctx: OperatorContext, value: [any, any], castType?: string): SQL {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('BETWEEN operator requires array of exactly 2 values');
  }
  
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} BETWEEN ${value[0]} AND ${value[1]}`;
  }
  
  return between(ctx.column, value[0], value[1]);
}

/**
 * Operator: NOT BETWEEN (value not in range)
 */
export function notBetweenOperator(ctx: OperatorContext, value: [any, any], castType?: string): SQL {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('NOT BETWEEN operator requires array of exactly 2 values');
  }
  
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`${leftSQL} NOT BETWEEN ${value[0]} AND ${value[1]}`;
  }
  
  return notBetween(ctx.column, value[0], value[1]);
}

/**
 * Operator: IS NULL
 * Example: { deletedAt: { isNull: true } } -> deletedAt IS NULL
 */
export function isNullOperator(ctx: OperatorContext, value: boolean | string, castType?: string): SQL {
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const checkValue = value === true || value === 'true';
    // Use sql keywords instead of sql.raw for NULL
    return checkValue ? sql`${leftSQL} IS NULL` : sql`${leftSQL} IS NOT NULL`;
  }

  const checkValue = value === true || (typeof value === 'string' && value === 'true');
  return checkValue ? isNull(ctx.column) : isNotNull(ctx.column);
}

/**
 * Operator: IS NOT NULL
 * Example: { deletedAt: { isNotNull: true } } -> deletedAt IS NOT NULL
 */
export function isNotNullOperator(ctx: OperatorContext, value: boolean | string, castType?: string): SQL {
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    const checkValue = value === true || (typeof value === 'string' && value === 'true');
    // Use sql keywords instead of sql.raw for NULL
    return checkValue ? sql`${leftSQL} IS NOT NULL` : sql`${leftSQL} IS NULL`;
  }

  const checkValue = value === true || (typeof value === 'string' && value === 'true');
  return checkValue ? isNotNull(ctx.column) : isNull(ctx.column);
}

/**
 * Operator: Array Contains (@>)
 * Example: { tags: { arraycontains: ['javascript', 'nodejs'] } }
 * PostgreSQL: tags @> ARRAY['javascript', 'nodejs']
 */
export function arrayContainsOperator(
  ctx: OperatorContext,
  value: any | any[],
  elementType: string = 'text'
): SQL {
  const preparedValues = Array.isArray(value) ? value : [value];
  const formattedArray = formatArrayForPostgreSQL(preparedValues, elementType);

  // Use buildColumnSQL for proper relation path handling (same pattern as other operators)
  if (ctx.tableName) {
    // For relational paths or when we have a table alias
    const columnSQL = buildColumnSQLString(ctx.fieldName);

    // For string types, cast to text[]
    if (['string', 'text', 'varchar'].includes(elementType)) {
      return sql.raw(`${columnSQL}::text[] @> ${formattedArray}`);
    }

    return sql.raw(`${columnSQL} @> ${formattedArray}`);
  }

  // Direct field without relation
  const formattedArrayDirect = formatArrayForPostgreSQL(value, elementType);

  // For string types, cast to text[]
  if (['string', 'text', 'varchar'].includes(elementType)) {
    const columnSQL = buildColumnSQLString(ctx.fieldName);
    return sql.raw(`${columnSQL}::text[] @> ${formattedArrayDirect}`);
  }

  const columnSQL = buildColumnSQLString(ctx.fieldName);
  return sql.raw(`${columnSQL} @> ${formattedArrayDirect}`);
}

/**
 * Operator: Array Contained By (<@)
 * Example: { tags: { arraycontained: ['javascript', 'nodejs', 'typescript'] } }
 * PostgreSQL: tags <@ ARRAY['javascript', 'nodejs', 'typescript']
 */
export function arrayContainedOperator(
  ctx: OperatorContext,
  value: any | any[],
  elementType: string = 'text'
): SQL {
  const preparedValues = Array.isArray(value) ? value : [value];
  const formattedArray = formatArrayForPostgreSQL(preparedValues, elementType);

  // Use buildColumnSQL for proper relation path handling (same pattern as other operators)
  if (ctx.tableName) {
    // For relational paths or when we have a table alias
    const columnSQL = buildColumnSQLString(ctx.fieldName);

    // For string types, cast to text[]
    if (['string', 'text', 'varchar'].includes(elementType)) {
      return sql.raw(`${columnSQL}::text[] <@ ${formattedArray}`);
    }

    return sql.raw(`${columnSQL} <@ ${formattedArray}`);
  }

  // Direct field without relation
  const formattedArrayDirect = formatArrayForPostgreSQL(value, elementType);

  // For string types, cast to text[]
  if (['string', 'text', 'varchar'].includes(elementType)) {
    const columnSQL = buildColumnSQLString(ctx.fieldName);
    return sql.raw(`${columnSQL}::text[] <@ ${formattedArrayDirect}`);
  }

  const columnSQL = buildColumnSQLString(ctx.fieldName);
  return sql.raw(`${columnSQL} <@ ${formattedArrayDirect}`);
}

// ============================================================================
// JSONB OPERATORS
// PostgreSQL provides powerful JSONB operators for querying JSON data.
// These operators allow filtering based on JSON structure and contents.
// ============================================================================

/**
 * Helper to build field reference for JSONB operations
 */
function buildFieldRef(fieldName: string): string {
  if (fieldName.startsWith('"')) {
    return fieldName;
  } else if (fieldName.includes('.')) {
    const [table, col] = fieldName.split('.');
    return `"${table}"."${col}"`;
  } else {
    return `"${fieldName}"`;
  }
}

/**
 * Safely escape and stringify JSON value for SQL
 */
function jsonToSqlString(value: any): string {
  return JSON.stringify(value).replace(/'/g, "''");
}

/**
 * Operator: JSONB Contains (@>)
 * Checks if the JSONB column contains the specified JSON value
 * Example: { metadata: { jsonbContains: { status: "active" } } }
 * PostgreSQL: metadata @> '{"status": "active"}'::jsonb
 * 
 * This operator tests whether the left JSONB value contains the right JSONB value.
 * A JSONB value contains another if it has all the keys and matching values.
 */
export function jsonbContainsOperator(ctx: OperatorContext, value: any): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const jsonValue = jsonToSqlString(value);
  return sql.raw(`${fieldRef} @> '${jsonValue}'::jsonb`);
}

/**
 * Operator: JSONB Contained By (<@)
 * Checks if the JSONB column is contained by the specified JSON value
 * Example: { metadata: { jsonbContainedBy: { status: "active", type: "user", role: "admin" } } }
 * PostgreSQL: metadata <@ '{"status": "active", "type": "user", "role": "admin"}'::jsonb
 * 
 * This operator tests whether the left JSONB value is contained by the right JSONB value.
 */
export function jsonbContainedByOperator(ctx: OperatorContext, value: any): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const jsonValue = jsonToSqlString(value);
  return sql.raw(`${fieldRef} <@ '${jsonValue}'::jsonb`);
}

/**
 * Operator: JSONB Has Key (?)
 * Checks if the JSONB column has a specific top-level key
 * Example: { metadata: { jsonbHasKey: "status" } }
 * PostgreSQL: metadata ? 'status'
 */
export function jsonbHasKeyOperator(ctx: OperatorContext, value: string): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value).replace(/'/g, "''");
  return sql.raw(`${fieldRef} ? '${escapedKey}'`);
}

/**
 * Operator: JSONB Has Any Keys (?|)
 * Checks if the JSONB column has any of the specified keys
 * Example: { metadata: { jsonbHasAnyKeys: ["status", "type", "role"] } }
 * PostgreSQL: metadata ?| array['status', 'type', 'role']
 */
export function jsonbHasAnyKeysOperator(ctx: OperatorContext, value: string[]): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const keys = Array.isArray(value) ? value : [value];
  const escapedKeys = keys.map(k => `'${String(k).replace(/'/g, "''")}'`).join(', ');
  return sql.raw(`${fieldRef} ?| array[${escapedKeys}]`);
}

/**
 * Operator: JSONB Has All Keys (?&)
 * Checks if the JSONB column has all of the specified keys
 * Example: { metadata: { jsonbHasAllKeys: ["status", "type"] } }
 * PostgreSQL: metadata ?& array['status', 'type']
 */
export function jsonbHasAllKeysOperator(ctx: OperatorContext, value: string[]): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const keys = Array.isArray(value) ? value : [value];
  const escapedKeys = keys.map(k => `'${String(k).replace(/'/g, "''")}'`).join(', ');
  return sql.raw(`${fieldRef} ?& array[${escapedKeys}]`);
}

/**
 * Operator: JSONB Path Exists (using @?)
 * Checks if a JSON path exists and returns any items
 * Example: { metadata: { jsonbPathExists: "$.user.preferences" } }
 * PostgreSQL: metadata @? '$.user.preferences'
 * 
 * This uses the JSON path language to query JSONB data.
 * The path can include filters like: $.items[*] ? (@.price > 10)
 */
export function jsonbPathExistsOperator(ctx: OperatorContext, value: string): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedPath = String(value).replace(/'/g, "''");
  return sql.raw(`${fieldRef} @? '${escapedPath}'`);
}

/**
 * Operator: JSONB Path Match (using @@)
 * Checks if a JSON path predicate returns true
 * Example: { metadata: { jsonbPathMatch: "$.price > 10" } }
 * PostgreSQL: metadata @@ '$.price > 10'
 * 
 * The path predicate must return a boolean value.
 */
export function jsonbPathMatchOperator(ctx: OperatorContext, value: string): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedPath = String(value).replace(/'/g, "''");
  return sql.raw(`${fieldRef} @@ '${escapedPath}'`);
}

/**
 * Operator: JSONB Not Contains (NOT @>)
 * Checks if the JSONB column does NOT contain the specified JSON value
 * Example: { metadata: { jsonbNotContains: { status: "deleted" } } }
 * PostgreSQL: NOT (metadata @> '{"status": "deleted"}'::jsonb)
 */
export function jsonbNotContainsOperator(ctx: OperatorContext, value: any): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const jsonValue = jsonToSqlString(value);
  return sql.raw(`NOT (${fieldRef} @> '${jsonValue}'::jsonb)`);
}

/**
 * Operator: JSONB Key Equals (->>, then compare)
 * Access a top-level key and compare its text value
 * Example: { metadata: { jsonbKeyEquals: { key: "status", value: "active" } } }
 * PostgreSQL: metadata->>'status' = 'active'
 * 
 * This is useful when you want to compare a specific key's value directly.
 */
export function jsonbKeyEqualsOperator(ctx: OperatorContext, value: { key: string; value: any }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  
  if (value.value === null) {
    return sql.raw(`${fieldRef}->>'${escapedKey}' IS NULL`);
  }
  
  if (typeof value.value === 'number') {
    return sql.raw(`(${fieldRef}->>'${escapedKey}')::numeric = ${value.value}`);
  }
  
  if (typeof value.value === 'boolean') {
    return sql.raw(`(${fieldRef}->>'${escapedKey}')::boolean = ${value.value}`);
  }
  
  const escapedValue = String(value.value).replace(/'/g, "''");
  return sql.raw(`${fieldRef}->>'${escapedKey}' = '${escapedValue}'`);
}

/**
 * Operator: JSONB Key Not Equals (->>, then compare)
 * Access a top-level key and compare its text value is NOT equal
 * Example: { metadata: { jsonbKeyNotEquals: { key: "status", value: "deleted" } } }
 * PostgreSQL: metadata->>'status' != 'deleted' OR metadata->>'status' IS NULL
 */
export function jsonbKeyNotEqualsOperator(ctx: OperatorContext, value: { key: string; value: any }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  
  if (value.value === null) {
    return sql.raw(`${fieldRef}->>'${escapedKey}' IS NOT NULL`);
  }
  
  if (typeof value.value === 'number') {
    return sql.raw(`(${fieldRef}->>'${escapedKey}')::numeric != ${value.value} OR ${fieldRef}->>'${escapedKey}' IS NULL`);
  }
  
  if (typeof value.value === 'boolean') {
    return sql.raw(`(${fieldRef}->>'${escapedKey}')::boolean != ${value.value} OR ${fieldRef}->>'${escapedKey}' IS NULL`);
  }
  
  const escapedValue = String(value.value).replace(/'/g, "''");
  return sql.raw(`${fieldRef}->>'${escapedKey}' != '${escapedValue}' OR ${fieldRef}->>'${escapedKey}' IS NULL`);
}

/**
 * Operator: JSONB Key Greater Than
 * Access a top-level key and compare if value is greater than
 * Example: { metadata: { jsonbKeyGt: { key: "price", value: 100 } } }
 * PostgreSQL: (metadata->>'price')::numeric > 100
 */
export function jsonbKeyGtOperator(ctx: OperatorContext, value: { key: string; value: number }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  return sql.raw(`(${fieldRef}->>'${escapedKey}')::numeric > ${value.value}`);
}

/**
 * Operator: JSONB Key Greater Than or Equal
 * Example: { metadata: { jsonbKeyGte: { key: "price", value: 100 } } }
 */
export function jsonbKeyGteOperator(ctx: OperatorContext, value: { key: string; value: number }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  return sql.raw(`(${fieldRef}->>'${escapedKey}')::numeric >= ${value.value}`);
}

/**
 * Operator: JSONB Key Less Than
 * Example: { metadata: { jsonbKeyLt: { key: "price", value: 100 } } }
 */
export function jsonbKeyLtOperator(ctx: OperatorContext, value: { key: string; value: number }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  return sql.raw(`(${fieldRef}->>'${escapedKey}')::numeric < ${value.value}`);
}

/**
 * Operator: JSONB Key Less Than or Equal
 * Example: { metadata: { jsonbKeyLte: { key: "price", value: 100 } } }
 */
export function jsonbKeyLteOperator(ctx: OperatorContext, value: { key: string; value: number }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  return sql.raw(`(${fieldRef}->>'${escapedKey}')::numeric <= ${value.value}`);
}

/**
 * Operator: JSONB Key In (->>, then IN)
 * Access a top-level key and check if value is in a list
 * Example: { metadata: { jsonbKeyIn: { key: "status", values: ["active", "pending"] } } }
 * PostgreSQL: metadata->>'status' IN ('active', 'pending')
 */
export function jsonbKeyInOperator(ctx: OperatorContext, value: { key: string; values: any[] }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  const values = Array.isArray(value.values) ? value.values : [value.values];
  const escapedValues = values.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
  return sql.raw(`${fieldRef}->>'${escapedKey}' IN (${escapedValues})`);
}

/**
 * Operator: JSONB Key Not In
 * Example: { metadata: { jsonbKeyNotIn: { key: "status", values: ["deleted", "archived"] } } }
 */
export function jsonbKeyNotInOperator(ctx: OperatorContext, value: { key: string; values: any[] }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  const values = Array.isArray(value.values) ? value.values : [value.values];
  const escapedValues = values.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
  return sql.raw(`${fieldRef}->>'${escapedKey}' NOT IN (${escapedValues})`);
}

/**
 * Operator: JSONB Key Like (->>, then ILIKE)
 * Access a top-level key and perform pattern matching
 * Example: { metadata: { jsonbKeyLike: { key: "name", pattern: "%john%" } } }
 * PostgreSQL: metadata->>'name' ILIKE '%john%'
 */
export function jsonbKeyLikeOperator(ctx: OperatorContext, value: { key: string; pattern: string }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value.key).replace(/'/g, "''");
  const escapedPattern = String(value.pattern).replace(/'/g, "''");
  return sql.raw(`${fieldRef}->>'${escapedKey}' ILIKE '${escapedPattern}'`);
}

/**
 * Operator: JSONB Key Is Null
 * Check if a specific key's value is null (not if the key is missing)
 * Example: { metadata: { jsonbKeyIsNull: "deletedAt" } }
 * PostgreSQL: metadata->>'deletedAt' IS NULL
 */
export function jsonbKeyIsNullOperator(ctx: OperatorContext, value: string): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value).replace(/'/g, "''");
  return sql.raw(`${fieldRef}->>'${escapedKey}' IS NULL`);
}

/**
 * Operator: JSONB Key Is Not Null
 * Check if a specific key's value is not null
 * Example: { metadata: { jsonbKeyIsNotNull: "createdAt" } }
 * PostgreSQL: metadata->>'createdAt' IS NOT NULL
 */
export function jsonbKeyIsNotNullOperator(ctx: OperatorContext, value: string): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedKey = String(value).replace(/'/g, "''");
  return sql.raw(`${fieldRef}->>'${escapedKey}' IS NOT NULL`);
}

/**
 * Operator: JSONB Array Length
 * Check the length of a JSONB array at a specific path
 * Example: { metadata: { jsonbArrayLength: { path: "items", op: "gte", value: 5 } } }
 * PostgreSQL: jsonb_array_length(metadata->'items') >= 5
 */
export function jsonbArrayLengthOperator(ctx: OperatorContext, value: { path?: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const operators: Record<string, string> = {
    eq: '=',
    ne: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<='
  };
  const sqlOp = operators[value.op] || '=';
  
  if (value.path) {
    const escapedPath = String(value.path).replace(/'/g, "''");
    return sql.raw(`jsonb_array_length(${fieldRef}->'${escapedPath}') ${sqlOp} ${value.value}`);
  }
  
  // If no path, assume the column itself is the array
  return sql.raw(`jsonb_array_length(${fieldRef}) ${sqlOp} ${value.value}`);
}

/**
 * Operator: JSONB Type Of
 * Check the type of a JSONB value or a key's value
 * Example: { metadata: { jsonbTypeOf: { path: "price", type: "number" } } }
 * PostgreSQL: jsonb_typeof(metadata->'price') = 'number'
 * 
 * Valid types: 'object', 'array', 'string', 'number', 'boolean', 'null'
 */
export function jsonbTypeOfOperator(ctx: OperatorContext, value: { path?: string; type: string }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const escapedType = String(value.type).replace(/'/g, "''");
  
  if (value.path) {
    const escapedPath = String(value.path).replace(/'/g, "''");
    return sql.raw(`jsonb_typeof(${fieldRef}->'${escapedPath}') = '${escapedType}'`);
  }
  
  return sql.raw(`jsonb_typeof(${fieldRef}) = '${escapedType}'`);
}

/**
 * Operator: JSONB Deep Value (using #>> for nested path)
 * Access a deeply nested value and compare
 * Example: { metadata: { jsonbDeepValue: { path: ["user", "preferences", "theme"], value: "dark" } } }
 * PostgreSQL: metadata #>> '{user,preferences,theme}' = 'dark'
 * 
 * The path array represents the keys to traverse.
 */
export function jsonbDeepValueOperator(ctx: OperatorContext, value: { path: string[]; value: any; op?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' }): SQL {
  const fieldRef = buildFieldRef(ctx.fieldName);
  const pathArray = Array.isArray(value.path) ? value.path : [value.path];
  const escapedPath = pathArray.map(p => String(p).replace(/"/g, '\\"')).join(',');
  const op = value.op || 'eq';
  
  const operators: Record<string, string> = {
    eq: '=',
    ne: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE'
  };
  const sqlOp = operators[op] || '=';
  
  if (value.value === null) {
    return op === 'ne' 
      ? sql.raw(`${fieldRef} #>> '{${escapedPath}}' IS NOT NULL`)
      : sql.raw(`${fieldRef} #>> '{${escapedPath}}' IS NULL`);
  }
  
  if (typeof value.value === 'number' && !['like', 'ilike'].includes(op)) {
    return sql.raw(`(${fieldRef} #>> '{${escapedPath}}')::numeric ${sqlOp} ${value.value}`);
  }
  
  const escapedValue = String(value.value).replace(/'/g, "''");
  return sql.raw(`${fieldRef} #>> '{${escapedPath}}' ${sqlOp} '${escapedValue}'`);
}

/**
 * Operator: ST_Within (geometry within)
 * Example: { location: { within: geoJSON } }
 */
export function withinOperator(ctx: OperatorContext, value: any): SQL {
  // Build properly quoted column reference
  let fieldRef: string;
  if (ctx.fieldName.startsWith('"')) {
    // Already quoted
    fieldRef = ctx.fieldName;
  } else if (ctx.fieldName.includes('.')) {
    const [table, col] = ctx.fieldName.split('.');
    fieldRef = `"${table}"."${col}"`;
  } else {
    fieldRef = `"${ctx.fieldName}"`;
  }
  return sql.raw(`ST_Within(${fieldRef}, ST_GeomFromGeoJSON('${JSON.stringify(value)}'))`);
}

/**
 * Operator: ST_Contains (geometry contains)
 * Example: { boundary: { containsGEO: geoJSON } }
 */
export function containsGEOOperator(ctx: OperatorContext, value: any): SQL {
  // Build properly quoted column reference
  let fieldRef: string;
  if (ctx.fieldName.startsWith('"')) {
    // Already quoted
    fieldRef = ctx.fieldName;
  } else if (ctx.fieldName.includes('.')) {
    const [table, col] = ctx.fieldName.split('.');
    fieldRef = `"${table}"."${col}"`;
  } else {
    fieldRef = `"${ctx.fieldName}"`;
  }
  return sql.raw(`ST_Contains(${fieldRef}, ST_GeomFromGeoJSON('${JSON.stringify(value)}'))`);
}

/**
 * Operator: ST_Intersects (geometries intersect)
 * Example: { area: { intersects: geoJSON } }
 */
export function intersectsOperator(ctx: OperatorContext, value: any): SQL {
  // Build properly quoted column reference
  let fieldRef: string;
  if (ctx.fieldName.startsWith('"')) {
    // Already quoted
    fieldRef = ctx.fieldName;
  } else if (ctx.fieldName.includes('.')) {
    const [table, col] = ctx.fieldName.split('.');
    fieldRef = `"${table}"."${col}"`;
  } else {
    fieldRef = `"${ctx.fieldName}"`;
  }
  // Cast column to geometry to resolve function overload ambiguity
  return sql.raw(`ST_Intersects(${fieldRef}::geometry, ST_GeomFromGeoJSON('${JSON.stringify(value)}'))`);
}

/**
 * Operator: NOT ST_Intersects
 */
export function nIntersectsOperator(ctx: OperatorContext, value: any): SQL {
  // Build properly quoted column reference
  let fieldRef: string;
  if (ctx.fieldName.startsWith('"')) {
    // Already quoted
    fieldRef = ctx.fieldName;
  } else if (ctx.fieldName.includes('.')) {
    const [table, col] = ctx.fieldName.split('.');
    fieldRef = `"${table}"."${col}"`;
  } else {
    fieldRef = `"${ctx.fieldName}"`;
  }
  return sql.raw(`NOT ST_Intersects(${fieldRef}, ST_GeomFromGeoJSON('${JSON.stringify(value)}'))`);
}

/**
 * Operator: ST_DWithin (within distance)
 * Example: { location: { dwithin: { geometry: geoJSON, distance: 1000, not: false } } }
 */
export function dwithinOperator(ctx: OperatorContext, value: { geometry: any; distance: number; not?: boolean }): SQL {
  const { geometry, distance, not: negated } = value;
  // Build properly quoted column reference
  let fieldRef: string;
  if (ctx.fieldName.startsWith('"')) {
    // Already quoted
    fieldRef = ctx.fieldName;
  } else if (ctx.fieldName.includes('.')) {
    const [table, col] = ctx.fieldName.split('.');
    fieldRef = `"${table}"."${col}"`;
  } else {
    fieldRef = `"${ctx.fieldName}"`;
  }

  const condition = `ST_DWithin(${fieldRef}::geography, ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'), 4326)::geography, ${distance})`;

  return negated ? sql.raw(`NOT (${condition})`) : sql.raw(condition);
}

/**
 * Operator: NOT
 * Example: { status: { not: 'active' } } -> status != 'active'
 * Example: { id: { not: null } } -> id IS NOT NULL
 */
export function notOperator(ctx: OperatorContext, value: FilterValue, castType?: string): SQL {
  // Special handling for null values - must use IS NOT NULL syntax
  if (value === null) {
    if (castType || ctx.tableName) {
      const leftSQL = buildColumnSQL(ctx.fieldName, castType);
      return sql`${leftSQL} IS NOT NULL`;
    }
    return isNotNull(ctx.column);
  }

  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    return sql`NOT (${leftSQL} = ${value})`;
  }

  return ne(ctx.column, value);
}

/**
 * Operator: IS
 * Example: { deletedAt: { is: null } } -> deletedAt IS NULL
 */
export function isOperator(ctx: OperatorContext, value: any, castType?: string): SQL {
  if (castType || ctx.tableName) {
    const leftSQL = buildColumnSQL(ctx.fieldName, castType);
    // Handle NULL specially with IS NULL syntax
    if (value === null || value === 'null') {
      return sql`${leftSQL} IS NULL`;
    }
    return sql`${leftSQL} IS ${value}`;
  }

  if (value === null) {
    return isNull(ctx.column);
  }

  return eq(ctx.column, value);
}

/**
 * Map of operator names to their handler functions
 */
export const OPERATOR_MAP = {
  // Comparison
  eq: eqOperator,
  ne: neOperator,
  gt: gtOperator,
  gte: gteOperator,
  lt: ltOperator,
  lte: lteOperator,
  
  // String pattern matching
  like: likeOperator,
  notLike: notLikeOperator,
  iLike: iLikeOperator,
  notILike: notILikeOperator,
  
  startsWith: startsWithOperator,
  startsWiths: startsWithsOperator,
  endsWith: endsWithOperator,
  endsWiths: endsWithsOperator,
  nstartsWith: nstartsWithOperator,
  nstartsWiths: nstartsWithsOperator,
  nendsWith: nendsWithOperator,
  nendsWiths: nendsWithsOperator,
  
  // Collection
  in: inOperator,
  notIn: notInOperator,
  not: notOperator,
  is: isOperator,
  
  // Range
  between: betweenOperator,
  notBetween: notBetweenOperator,
  
  // Null checks
  isNull: isNullOperator,
  isNotNull: isNotNullOperator,
  
  // Array operators
  arraycontains: arrayContainsOperator,
  arraycontained: arrayContainedOperator,
  
  // JSONB operators
  jsonbContains: jsonbContainsOperator,
  jsonbContainedBy: jsonbContainedByOperator,
  jsonbHasKey: jsonbHasKeyOperator,
  jsonbHasAnyKeys: jsonbHasAnyKeysOperator,
  jsonbHasAllKeys: jsonbHasAllKeysOperator,
  jsonbPathExists: jsonbPathExistsOperator,
  jsonbPathMatch: jsonbPathMatchOperator,
  jsonbNotContains: jsonbNotContainsOperator,
  jsonbKeyEquals: jsonbKeyEqualsOperator,
  jsonbKeyNotEquals: jsonbKeyNotEqualsOperator,
  jsonbKeyGt: jsonbKeyGtOperator,
  jsonbKeyGte: jsonbKeyGteOperator,
  jsonbKeyLt: jsonbKeyLtOperator,
  jsonbKeyLte: jsonbKeyLteOperator,
  jsonbKeyIn: jsonbKeyInOperator,
  jsonbKeyNotIn: jsonbKeyNotInOperator,
  jsonbKeyLike: jsonbKeyLikeOperator,
  jsonbKeyIsNull: jsonbKeyIsNullOperator,
  jsonbKeyIsNotNull: jsonbKeyIsNotNullOperator,
  jsonbArrayLength: jsonbArrayLengthOperator,
  jsonbTypeOf: jsonbTypeOfOperator,
  jsonbDeepValue: jsonbDeepValueOperator,
  
  // Geo operators
  within: withinOperator,
  containsGEO: containsGEOOperator,
  intersects: intersectsOperator,
  nIntersects: nIntersectsOperator,
  dwithin: dwithinOperator,
} as const;

export type OperatorName = keyof typeof OPERATOR_MAP;

/**
 * Apply an operator to a column with a value
 */
export function applyOperator(
  operatorName: string,
  ctx: OperatorContext,
  value: FilterValue,
  castType?: string,
  elementType?: string
): SQL | null {
  const operator = OPERATOR_MAP[operatorName as OperatorName];
  
  if (!operator) {
    console.warn(`Unknown operator: ${operatorName}`);
    return null;
  }
  
  // Special handling for array operators
  if (operatorName === 'arraycontains' || operatorName === 'arraycontained') {
    return operator(ctx, value, elementType);
  }
  
  // @ts-ignore - Type complexity with operator overloads
  return operator(ctx, value, castType);
}
