import { Express } from "express";
import permissionService from "../services/PermissionService.js";
import ItemsService from "../services/ItemsService.js";
import { adminOnly } from "../utils/auth.js";
import { APIError } from "../utils/errorHandler.js";
import { getCacheService } from "../utils/db.js";
import { getCache } from "../utils/cache.js";

/**
 * Helper function to invalidate cache for affected collections when permissions change
 */
async function invalidateCollectionCache(collection: string): Promise<void> {
  try {
    const cache = getCacheService();
    if (cache) {
      await cache.onMutate({ tables: [collection] });
    }
  } catch (error) {
    console.error(`[PermissionRoute] Failed to invalidate cache for ${collection}:`, error);
  }
}

/**
 * Invalidate auth cache for a specific role when permissions change
 * This ensures getRolesAndPermissions() gets fresh data
 */
async function invalidateAuthCache(role_Id?: string): Promise<void> {
  try {
    const cache = getCache();
    if (role_Id) {
      // Invalidate specific role's auth cache
      const cacheKey = `auth:role:${role_Id}:permissions`;
      await cache.delete(cacheKey);
    } else {
      // Invalidate all auth role caches
      await cache.invalidateModel("auth");
    }
  } catch (error) {
    console.error(`[PermissionRoute] Failed to invalidate auth cache:`, error);
  }
}

const registerEndpoint = (app: Express) => {
  // Get all permissions
  app.get("/permissions", async (req, res, next) => {
    try {
      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      const result = await itemsService.readByQuery({
        limit: -1,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Get single permission
  app.get("/permissions/:id", async (req, res, next) => {
    try {
      const { id } = req.params;

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      const permission = await itemsService.readOne(id);

      res.json({ data: permission });
    } catch (error) {
      next(error);
    }
  });

  // Create permission
  app.post("/permissions", adminOnly, async (req, res, next) => {
    try {
      const data = req.body;

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      const newId = await itemsService.createOne(data);

      // Read the created permission to return full object
      const newPermission = await itemsService.readOne(newId);

      // Reload permissions
      await permissionService.loadPermissions();

      // Invalidate auth cache for the affected role
      if (data.role_Id) {
        await invalidateAuthCache(data.role_Id);
      }

      // Invalidate cache for the affected collection
      if (data.collection) {
        await invalidateCollectionCache(data.collection);
      }

      res.status(201).json(newPermission);
    } catch (error) {
      next(error);
    }
  });

  // Update permission
  app.patch("/permissions/:id", adminOnly, async (req, res, next) => {
    try {
      const { id } = req.params;
      const data = req.body;

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      // Get old permission to check which collection and role to invalidate
      const oldPermission = await itemsService.readOne(id);

      await itemsService.updateOne(id, data);

      // Read the updated permission to return full object
      const updatedPermission = await itemsService.readOne(id);

      // Reload permissions
      await permissionService.loadPermissions();

      // Invalidate auth cache for both old and new roles (if role changed)
      const rolesToInvalidate = new Set<string>();
      if (oldPermission.role_Id) {
        rolesToInvalidate.add(oldPermission.role_Id);
      }
      if (data.role_Id) {
        rolesToInvalidate.add(data.role_Id);
      }
      for (const roleId of rolesToInvalidate) {
        await invalidateAuthCache(roleId);
      }

      // Invalidate cache for both old and new collections (if collection changed)
      const collectionsToInvalidate = new Set<string>();
      if (oldPermission.collection) {
        collectionsToInvalidate.add(oldPermission.collection);
      }
      if (data.collection) {
        collectionsToInvalidate.add(data.collection);
      }

      for (const collection of collectionsToInvalidate) {
        await invalidateCollectionCache(collection);
      }

      res.json(updatedPermission);
    } catch (error) {
      next(error);
    }
  });

  // Delete permission
  app.delete("/permissions/:id", adminOnly, async (req, res, next) => {
    try {
      const { id } = req.params;

      const itemsService = new ItemsService("baasix_Permission", {
        accountability: req.accountability as any,
      });

      // Get permission before deleting to know which collection and role to invalidate
      const permission = await itemsService.readOne(id);

      await itemsService.deleteOne(id);

      // Reload permissions
      await permissionService.loadPermissions();

      // Invalidate auth cache for the affected role
      if (permission.role_Id) {
        await invalidateAuthCache(permission.role_Id);
      }

      // Invalidate cache for the affected collection
      if (permission.collection) {
        await invalidateCollectionCache(permission.collection);
      }

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Manually reload permission cache
  app.post("/permissions/reload", adminOnly, async (req, res, next) => {
    try {
      await permissionService.loadPermissions();

      // Invalidate all auth role caches since permissions affect all roles
      await invalidateAuthCache();

      // Note: We no longer call cache.invalidateCollection() here because
      // getCacheService() returns the DrizzleCache which uses the same Redis
      // database as the permission cache. Calling invalidateCollection() without
      // a collection parameter calls clear() which flushes the ENTIRE Redis database,
      // including the permission cache that was just populated by loadPermissions().
      // This was causing a race condition where permissions would be loaded,
      // then immediately deleted, then the next request would find no permissions.
      // 
      // Query caches will naturally expire based on their TTL, or they will be
      // invalidated when items are created/updated/deleted in their collections.

      res.status(200).json({ message: "Permission cache reloaded successfully" });
    } catch (error) {
      next(new APIError("Error reloading permissions", 500, error.message));
    }
  });
};

export default {
  id: "permissions",
  handler: registerEndpoint,
};
