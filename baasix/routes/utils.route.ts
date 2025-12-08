import { Express } from "express";
import { APIError } from "../utils/errorHandler.js";
import { schemaManager } from "../utils/schemaManager.js";
import { db as dbInstance } from "../utils/db.js";
import permissionService from "../services/PermissionService.js";
import { and, gte, eq, sql } from "drizzle-orm";
import { isAdmin } from "../utils/auth.js";
import { invalidateCollection } from "../services/CacheService.js";

const registerEndpoint = (app: Express, context: any) => {
  const db = dbInstance;

  /**
   * Sort items within a collection
   * This route supports moving an item before/after another item
   * Similar to Directus's sort functionality
   */
  app.post("/utils/sort/:collection", async (req, res, next) => {
    try {
      const { collection } = req.params;
      const { item, to } = req.body;

      if (!item) throw new APIError("Missing item ID to sort", 400);
      if (!to) throw new APIError("Missing target ID to sort to", 400);

      // Check if the collection exists by trying to get its schema
      let schemaInfo;
      try {
        schemaInfo = schemaManager.getSchema(collection);
        if (!schemaInfo) {
          throw new APIError(`Collection '${collection}' does not exist`, 404);
        }
      } catch (error) {
        throw new APIError(`Collection '${collection}' does not exist`, 404);
      }

      if (!isAdmin(req)) {
        // Check if user is authenticated first (user must exist and not be public role)
        const roleName = typeof req.accountability?.role === 'object'
          ? (req.accountability?.role as any)?.name
          : req.accountability?.role;

        if (!req.accountability || !req.accountability.user || roleName === 'public') {
          throw new APIError("Authentication required", 401);
        }

        // Check if user has sort permission for this collection using permissionService
        const role = req.accountability.role as any;
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

      // Get the table
      const table = schemaManager.getTable(collection);
      const primaryKeyField = schemaManager.getPrimaryKey(collection);

      // Check if the table has a sort field
      if (!table || !table.sort) {
        throw new APIError(`Collection '${collection}' does not have a sort field`, 400);
      }

      // Start a transaction to ensure consistency
      try {
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
        // Use raw SQL for dynamic table columns
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

        return res.status(200).json({
          data: {
            item: item,
            collection,
          },
        });
      } catch (error: any) {
        console.error('[Sort Endpoint] Error:', error.message, error.stack);
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "utils",
  handler: registerEndpoint,
};
