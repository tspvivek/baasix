/**
 * Soft Delete Plugin for Drizzle ORM
 * Provides Sequelize-style paranoid mode functionality
 * 
 * Features:
 * - Automatic deletedAt field addition
 * - Query filtering to exclude soft-deleted records
 * - Restore functionality
 * - Force delete option
 */

import { timestamp } from 'drizzle-orm/pg-core';
import { SQL, and, isNull } from 'drizzle-orm';

export interface SoftDeleteOptions {
  deletedAtColumn?: string;
  defaultScope?: boolean;
}

export interface SoftDeleteMixin {
  deletedAt: ReturnType<typeof timestamp>;
}

/**
 * Add soft delete capability to a table schema
 * Usage:
 *   const users = softDeleteTable('users', {
 *     id: uuid('id').primaryKey(),
 *     name: varchar('name', { length: 255 })
 *   });
 */
export function withSoftDelete<T extends Record<string, any>>(
  tableName: string,
  columns: T,
  options: SoftDeleteOptions = {}
): T & SoftDeleteMixin {
  const deletedAtColumn = options.deletedAtColumn || 'deletedAt';
  
  return {
    ...columns,
    [deletedAtColumn]: timestamp(deletedAtColumn),
  } as T & SoftDeleteMixin;
}

/**
 * Soft Delete Query Helper
 * Provides methods to work with soft-deleted records
 */
export class SoftDeleteHelper {
  private deletedAtColumn: string;

  constructor(deletedAtColumn: string = 'deletedAt') {
    this.deletedAtColumn = deletedAtColumn;
  }

  /**
   * Get filter to exclude soft-deleted records
   * Usage: where(table, softDelete.excludeDeleted(table))
   */
  excludeDeleted(table: any): SQL {
    return isNull(table[this.deletedAtColumn]);
  }

  /**
   * Get filter to include only soft-deleted records
   * Usage: where(table, softDelete.onlyDeleted(table))
   */
  onlyDeleted(table: any): SQL {
    return isNull(table[this.deletedAtColumn]);
  }

  /**
   * Add soft-delete filter to existing where clause
   * Usage: where(table, and(customFilter, softDelete.withSoftDelete(table)))
   */
  withSoftDelete(table: any, includeDeleted: boolean = false): SQL | undefined {
    if (includeDeleted) {
      return undefined;
    }
    return this.excludeDeleted(table);
  }

  /**
   * Create a soft-delete timestamp
   * Returns current timestamp for deletedAt field
   */
  markAsDeleted(): Date {
    return new Date();
  }

  /**
   * Create a restore value (null for deletedAt)
   * Returns null to restore a soft-deleted record
   */
  markAsRestored(): null {
    return null;
  }
}

/**
 * Soft Delete Middleware
 * Automatically applies soft-delete filters to queries
 */
export class SoftDeleteMiddleware {
  private helper: SoftDeleteHelper;
  private paranoidMode: boolean;

  constructor(paranoidMode: boolean = true, deletedAtColumn: string = 'deletedAt') {
    this.helper = new SoftDeleteHelper(deletedAtColumn);
    this.paranoidMode = paranoidMode;
  }

  /**
   * Wrap a where clause with soft-delete filter
   */
  applyFilter(table: any, existingWhere?: SQL, options: { paranoid?: boolean } = {}): SQL | undefined {
    const useParanoid = options.paranoid ?? this.paranoidMode;
    
    if (!useParanoid) {
      return existingWhere;
    }

    const softDeleteFilter = this.helper.excludeDeleted(table);
    
    if (existingWhere) {
      return and(existingWhere, softDeleteFilter);
    }
    
    return softDeleteFilter;
  }

  /**
   * Soft delete a record (set deletedAt to current timestamp)
   */
  getSoftDeleteUpdate() {
    return {
      deletedAt: this.helper.markAsDeleted(),
    };
  }

  /**
   * Restore a soft-deleted record (set deletedAt to null)
   */
  getRestoreUpdate() {
    return {
      deletedAt: this.helper.markAsRestored(),
    };
  }
}

/**
 * Default soft delete helper instance
 */
export const softDeleteHelper = new SoftDeleteHelper();

/**
 * Default soft delete middleware instance
 */
export const softDeleteMiddleware = new SoftDeleteMiddleware();

/**
 * Utility functions for common soft-delete operations
 */

/**
 * Build a soft delete update object
 * Usage: db.update(users).set(softDelete(userId))
 */
export function softDelete(userId?: string) {
  return {
    deletedAt: new Date(),
    ...(userId && { userDeleted_Id: userId }),
  };
}

/**
 * Build a restore update object
 * Usage: db.update(users).set(restore())
 */
export function restore() {
  return {
    deletedAt: null,
  };
}

/**
 * Check if a record is soft-deleted
 * Usage: if (isSoftDeleted(record)) { ... }
 */
export function isSoftDeleted(record: any, deletedAtColumn: string = 'deletedAt'): boolean {
  return record[deletedAtColumn] != null;
}

/**
 * Filter array of records to exclude soft-deleted
 * Usage: const active = filterSoftDeleted(allRecords)
 */
export function filterSoftDeleted<T extends Record<string, any>>(
  records: T[],
  deletedAtColumn: string = 'deletedAt'
): T[] {
  return records.filter(record => !isSoftDeleted(record, deletedAtColumn));
}

/**
 * Filter array of records to include only soft-deleted
 * Usage: const deleted = filterOnlyDeleted(allRecords)
 */
export function filterOnlyDeleted<T extends Record<string, any>>(
  records: T[],
  deletedAtColumn: string = 'deletedAt'
): T[] {
  return records.filter(record => isSoftDeleted(record, deletedAtColumn));
}

/**
 * Example usage in a query builder wrapper
 */
export class SoftDeleteQueryBuilder<T> {
  private table: any;
  private middleware: SoftDeleteMiddleware;
  private withDeleted: boolean = false;
  private onlyDeletedFlag: boolean = false;

  constructor(table: any, paranoidMode: boolean = true) {
    this.table = table;
    this.middleware = new SoftDeleteMiddleware(paranoidMode);
  }

  /**
   * Include soft-deleted records in results
   */
  includeDeleted(): this {
    this.withDeleted = true;
    return this;
  }

  /**
   * Only return soft-deleted records
   */
  onlyDeleted(): this {
    this.onlyDeletedFlag = true;
    this.withDeleted = true;
    return this;
  }

  /**
   * Get the appropriate where clause
   */
  getWhereClause(existingWhere?: SQL): SQL | undefined {
    if (this.withDeleted && !this.onlyDeletedFlag) {
      return existingWhere;
    }

    if (this.onlyDeletedFlag) {
      const onlyDeletedFilter = softDeleteHelper.onlyDeleted(this.table);
      return existingWhere ? and(existingWhere, onlyDeletedFilter) : onlyDeletedFilter;
    }

    return this.middleware.applyFilter(this.table, existingWhere);
  }

  /**
   * Perform soft delete
   */
  getSoftDeleteData(userId?: string) {
    return softDelete(userId);
  }

  /**
   * Perform restore
   */
  getRestoreData() {
    return restore();
  }
}

export default {
  withSoftDelete,
  SoftDeleteHelper,
  SoftDeleteMiddleware,
  SoftDeleteQueryBuilder,
  softDeleteHelper,
  softDeleteMiddleware,
  softDelete,
  restore,
  isSoftDeleted,
  filterSoftDeleted,
  filterOnlyDeleted,
};
