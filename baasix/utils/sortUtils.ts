/**
 * Sort Utilities
 * 
 * Provides functions for sorting items within collections.
 * Can be used by routes and extensions.
 */

import { schemaManager } from "./schemaManager.js";
import { db as dbInstance } from "./db.js";
import { eq, sql } from "drizzle-orm";
import { APIError } from "./errorHandler.js";
import { invalidateCollection } from "../services/CacheService.js";
import { isAdmin } from "./auth.js";
import permissionService from "../services/PermissionService.js";

export interface SortOptions {
  /**
   * Collection name
   */
  collection: string;
  /**
   * ID of the item to move
   */
  item: string | number;
  /**
   * ID of the target item to move before
   */
  to: string | number;
  /**
   * Accountability object from request (for permission checks)
   * If not provided, bypassPermissions must be true
   */
  accountability?: {
    user?: any;
    role?: any;
    roles?: string[];
    permissions?: any[];
    tenant?: string | null;
  };
  /**
   * Whether to skip permission checks (for internal use)
   * @default false
   */
  bypassPermissions?: boolean;
  /**
   * Database transaction to use
   */
  transaction?: any;
}

export interface SortResult {
  item: string | number;
  collection: string;
  newSort: number;
}

/**
 * Sort an item within a collection by moving it before another item.
 * This updates the sort field of the target item and all items after it.
 * 
 * @example
 * ```typescript
 * import { sortItems } from '@baasix/utils';
 * 
 * // Move item 'abc' before item 'xyz' in the 'tasks' collection
 * const result = await sortItems({
 *   collection: 'tasks',
 *   item: 'abc',
 *   to: 'xyz',
 *   accountability: req.accountability, // Pass accountability for permission checks
 * });
 * 
 * // Or bypass permissions for internal operations
 * const result = await sortItems({
 *   collection: 'tasks',
 *   item: 'abc',
 *   to: 'xyz',
 *   bypassPermissions: true,
 * });
 * ```
 */
export async function sortItems(options: SortOptions): Promise<SortResult> {
  const { collection, item, to, accountability, bypassPermissions = false, transaction } = options;
  const db = transaction || dbInstance;

  // Validate inputs
  if (!item) {
    throw new APIError("Missing item ID to sort", 400);
  }
  if (!to) {
    throw new APIError("Missing target ID to sort to", 400);
  }

  // Check if the collection exists
  let schemaInfo;
  try {
    schemaInfo = schemaManager.getSchema(collection);
    if (!schemaInfo) {
      throw new APIError(`Collection '${collection}' does not exist`, 404);
    }
  } catch (error) {
    throw new APIError(`Collection '${collection}' does not exist`, 404);
  }

  // Permission checks (unless bypassed)
  if (!bypassPermissions) {
    if (!accountability) {
      throw new APIError("Accountability is required for permission checks. Use bypassPermissions: true for internal operations.", 400);
    }

    // Check if user is admin
    const userIsAdmin = isAdmin({ accountability });

    if (!userIsAdmin) {
      // Check if user is authenticated (not public role)
      const roleName = typeof accountability.role === 'object'
        ? (accountability.role as any)?.name
        : accountability.role;

      if (!accountability.user || roleName === 'public') {
        throw new APIError("Authentication required", 401);
      }

      // Check if user has sort permission for this collection
      const role = accountability.role as any;
      const roleId = typeof role === 'object' ? role.id : role;

      const hasAccess = await permissionService.canAccess(
        roleId,
        collection,
        "update",
        ["sort"]
      );

      if (!hasAccess) {
        throw new APIError(`You don't have permission to sort items in '${collection}'`, 403);
      }
    }
  }

  // Get the table
  const table = schemaManager.getTable(collection);
  const primaryKeyField = schemaManager.getPrimaryKey(collection);

  // Check if the table has a sort field
  if (!table || !table.sort) {
    throw new APIError(`Collection '${collection}' does not have a sort field`, 400);
  }

  // Find the item to move and the target item
  const itemToMove = await db
    .select()
    .from(table)
    .where(eq(table[primaryKeyField], item))
    .limit(1);

  const targetItem = await db
    .select()
    .from(table)
    .where(eq(table[primaryKeyField], to))
    .limit(1);

  if (!itemToMove || itemToMove.length === 0) {
    throw new APIError(`Item with ID ${item} not found`, 404);
  }

  if (!targetItem || targetItem.length === 0) {
    throw new APIError(`Target item with ID ${to} not found`, 404);
  }

  // Get the current sort value of the target item
  const targetSort = targetItem[0].sort || 0;

  // Update all items with sort value >= targetSort (increment by 1)
  await db.execute(sql`
    UPDATE "${sql.raw(collection)}"
    SET "sort" = "sort" + 1
    WHERE "sort" >= ${targetSort}
  `);

  // Update the sort value of the item we're moving
  await db.execute(sql`
    UPDATE "${sql.raw(collection)}"
    SET "sort" = ${targetSort}
    WHERE "${sql.raw(primaryKeyField)}" = ${item}
  `);

  // Invalidate collection cache after sort changes
  await invalidateCollection(collection);

  return {
    item,
    collection,
    newSort: targetSort,
  };
}

/**
 * Reorder items in a collection by setting their sort values in order.
 * Useful for bulk reordering operations.
 * 
 * @example
 * ```typescript
 * import { reorderItems } from '@baasix/utils';
 * 
 * // Reorder items in the specified order
 * await reorderItems({
 *   collection: 'tasks',
 *   items: ['id1', 'id2', 'id3'], // Items will be sorted in this order
 * });
 * ```
 */
export async function reorderItems(options: {
  collection: string;
  items: (string | number)[];
  startSort?: number;
  transaction?: any;
}): Promise<void> {
  const { collection, items, startSort = 1, transaction } = options;
  const db = transaction || dbInstance;

  if (!items || items.length === 0) {
    throw new APIError("Missing items array to reorder", 400);
  }

  // Check if the collection exists
  const schemaInfo = schemaManager.getSchema(collection);
  if (!schemaInfo) {
    throw new APIError(`Collection '${collection}' does not exist`, 404);
  }

  // Get the table
  const table = schemaManager.getTable(collection);
  const primaryKeyField = schemaManager.getPrimaryKey(collection);

  // Check if the table has a sort field
  if (!table || !table.sort) {
    throw new APIError(`Collection '${collection}' does not have a sort field`, 400);
  }

  // Update each item's sort value
  for (let i = 0; i < items.length; i++) {
    const itemId = items[i];
    const sortValue = startSort + i;

    await db.execute(sql`
      UPDATE "${sql.raw(collection)}"
      SET "sort" = ${sortValue}
      WHERE "${sql.raw(primaryKeyField)}" = ${itemId}
    `);
  }

  // Invalidate collection cache after sort changes
  await invalidateCollection(collection);
}

/**
 * Get the next available sort value for a collection.
 * Useful when adding new items to the end of a sorted list.
 * 
 * @example
 * ```typescript
 * import { getNextSortValue } from '@baasix/utils';
 * 
 * const nextSort = await getNextSortValue('tasks');
 * // Use nextSort when creating a new item
 * ```
 */
export async function getNextSortValue(collection: string, transaction?: any): Promise<number> {
  const db = transaction || dbInstance;

  // Check if the collection exists
  const schemaInfo = schemaManager.getSchema(collection);
  if (!schemaInfo) {
    throw new APIError(`Collection '${collection}' does not exist`, 404);
  }

  // Get the table
  const table = schemaManager.getTable(collection);

  // Check if the table has a sort field
  if (!table || !table.sort) {
    throw new APIError(`Collection '${collection}' does not have a sort field`, 400);
  }

  // Get the maximum sort value
  const result = await db.execute(sql`
    SELECT COALESCE(MAX("sort"), 0) + 1 as next_sort
    FROM "${sql.raw(collection)}"
  `);

  const rows = result.rows || result;
  return rows[0]?.next_sort || 1;
}

export default {
  sortItems,
  reorderItems,
  getNextSortValue,
};
