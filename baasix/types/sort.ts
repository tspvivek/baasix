/**
 * Sort and Order Types
 * Centralized sorting and ordering type definitions
 */

import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';

/**
 * Sort direction
 */
export type SortDirection = 'ASC' | 'DESC' | 'asc' | 'desc';

/**
 * Sort object structure (Sequelize-style)
 * Example: { name: 'ASC', createdAt: 'DESC' }
 */
export interface SortObject {
  [field: string]: SortDirection;
}

/**
 * Query context for sorting
 */
export interface SortContext {
  table?: PgTable;
  tableName?: string;
  schema?: Record<string, PgColumn>;
}
