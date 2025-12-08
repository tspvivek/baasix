/**
 * Aggregation Types
 * Centralized aggregation and grouping type definitions
 */

import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Aggregate function types
 */
export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct' | 'array_agg';

/**
 * Aggregate configuration
 */
export interface AggregateConfig {
  function: AggregateFunction;
  field: string; // Can be relation path like "author.posts.id"
}

/**
 * Aggregate result mapping
 * Example: { totalUsers: { function: 'count', field: 'id' } }
 */
export interface AggregateMapping {
  [alias: string]: AggregateConfig;
}

/**
 * Context for building aggregates
 */
export interface AggregateContext {
  tableName?: string;
  schema?: Record<string, PgColumn>;
  pathToAliasMap?: Map<string, string>; // Maps relation paths to JOIN aliases
}

/**
 * Date part extraction types
 */
export type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'week' | 'dow' | 'isodow' | 'quarter';

/**
 * Date truncation precision types
 */
export type DateTruncPrecision = 'day' | 'week' | 'month' | 'year' | 'hour' | 'minute' | 'second';
