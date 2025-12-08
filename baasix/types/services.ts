/**
 * Service Types
 * Centralized service-related type definitions
 */

import type { FilterObject } from './query.js';
import type { AggregateMapping } from './aggregation.js';
import type { IncludeConfig } from './relations.js';
import type { Accountability } from './auth.js';
import type { Transaction } from './database.js';

/**
 * Query options for read operations
 */
export interface QueryOptions {
  fields?: string[];
  filter?: FilterObject;
  sort?: string[] | Record<string, 'asc' | 'desc'>;
  limit?: number;
  page?: number;
  offset?: number;
  aggregate?: AggregateMapping;
  groupBy?: string[];
  search?: string;
  searchFields?: string[];
  sortByRelevance?: boolean;
  include?: IncludeConfig[];
  relConditions?: Record<string, FilterObject>;
  paranoid?: boolean; // false to include soft-deleted records
}

/**
 * Service options passed during construction
 */
export interface ServiceParams {
  accountability?: Accountability;
  tenant?: string | number;
}

/**
 * Operation options for write operations
 */
export interface OperationOptions {
  bypassPermissions?: boolean;
  transaction?: Transaction;
  force?: boolean; // Force hard delete even if paranoid mode is enabled
}

/**
 * Result for read operations
 */
export interface ReadResult {
  data: any[];
  totalCount: number;
}

/**
 * Permission filter interface
 */
export interface PermissionFilter {
  conditions?: Record<string, any>;
  relConditions?: Record<string, any>;
}

/**
 * Hook context interface
 */
export interface HookContext {
  [key: string]: any;
}

/**
 * Hook function type
 */
export type HookFunction = (context: HookContext) => Promise<HookContext> | HookContext;
