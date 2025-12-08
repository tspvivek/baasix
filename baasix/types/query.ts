/**
 * Query, Filter, and Pagination Types
 * Centralized query-building type definitions
 */

import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { JoinDefinition } from './relations.js';

/**
 * Filter object structure (Sequelize-style)
 */
export interface FilterObject {
  [key: string]: any;
  AND?: FilterObject[];
  OR?: FilterObject[];
  cast?: string;
}

/**
 * Query context for building where conditions
 */
export interface QueryContext {
  table?: PgTable;
  tableName?: string;
  schema?: Record<string, PgColumn>;
  schemaDefinition?: any; // From SchemaManager
  joins?: JoinDefinition[]; // Array to accumulate joins for relation paths
  forPermissionCheck?: boolean; // If true, use INNER JOINs for relation filters to enforce existence
}

/**
 * Column reference format for filter values
 * Format: $COL(columnName) or $COL(tableName.columnName)
 */
export type ColumnReference = string;

/**
 * Type for filter operator values
 */
export type FilterValue = string | number | boolean | null | Date | any[] | Record<string, any> | ColumnReference;

/**
 * Interface for operator context
 */
export interface OperatorContext {
  column: PgColumn;
  schemaTable?: any; // Drizzle table schema
  fieldName: string;
  tableName?: string;
}

/**
 * Operator name type (keys of OPERATOR_MAP)
 * Note: This should match the keys of OPERATOR_MAP in filterOperators.ts
 * Full type definition is generated there.
 */
export type OperatorName =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'nin' | 'like' | 'ilike' | 'nlike' | 'nilike'
  | 'between' | 'nbetween' | 'null' | 'nnull' | 'empty' | 'nempty'
  | 'contains' | 'ncontains' | 'starts_with' | 'nstarts_with'
  | 'ends_with' | 'nends_with' | 'regex' | 'intersects'
  | 'nintersects' | 'intersects_bbox' | 'nintersects_bbox';

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Pagination metadata
 */
export interface PaginationMetadata {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
