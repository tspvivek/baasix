/**
 * Common utilities for routes
 * Contains reusable functions that are duplicated across multiple route files
 */

import { schemaManager } from "./schemaManager.js";
import { APIError } from "./errorHandler.js";
import { getCache } from "./cache.js";
import { getCacheService } from "./db.js";
import settingsService from "../services/SettingsService.js";
import env from "./env.js";

/**
 * Middleware to check if a model/collection exists
 * Used in: items.route.ts, reports.route.ts
 */
export const modelExistsMiddleware = (req: any, res: any, next: any) => {
  const modelName = req.params.collection;
  if (!schemaManager.modelExists(modelName)) {
    return next(new APIError(`Model ${modelName} not found`, 404));
  }
  next();
};

/**
 * Throws APIError if user is not authenticated
 * Used in: notification.route.ts (4 times)
 */
export function requireAuth(req: any): void {
  if (!req.accountability?.user?.id) {
    throw new APIError("Authentication required", 401);
  }
}

/**
 * Check if a collection has a tenant_Id field (supports tenant isolation)
 */
export function collectionHasTenantField(collection: string): boolean {
  try {
    const table = schemaManager.getTable(collection);
    // Check if table has tenant_Id column
    return 'tenant_Id' in table;
  } catch {
    return false;
  }
}

/**
 * Validates and adjusts accountability for imports
 * 
 * Rules:
 * - User must be authenticated (not public)
 * - In multi-tenant mode, for collections with tenant_Id field:
 *   - Tenant-specific users: use their tenant from accountability (already set)
 *   - Administrators/non-tenant-specific users: must provide tenant in body
 * - In single-tenant mode or for collections without tenant_Id: no tenant handling needed
 * 
 * Used in: items.route.ts (import-csv and import-json)
 */
export function getImportAccountability(req: any, collection?: string): any {
  const accountability = req.accountability;
  
  // Check if user is authenticated (not public)
  if (!accountability?.user?.id) {
    throw new APIError("Authentication required for import operations", 401);
  }
  
  const isMultiTenant = env.get('MULTI_TENANT') === 'true';
  
  // If not multi-tenant mode, just return original accountability
  if (!isMultiTenant) {
    return accountability;
  }
  
  // Check if the collection supports tenant isolation
  const hasTenantField = collection ? collectionHasTenantField(collection) : false;
  
  // If collection doesn't have tenant field, no tenant handling needed
  if (!hasTenantField) {
    return accountability;
  }
  
  // Check if user has a tenant-specific role (accountability already has tenant set)
  const isTenantSpecific = accountability?.role?.isTenantSpecific === true;
  const userTenant = accountability?.tenant;
  
  if (isTenantSpecific && userTenant) {
    // Tenant-specific users: tenant is already in accountability, just return it
    return accountability;
  } else {
    // Administrators or non-tenant-specific users
    // They must provide tenant in body for tenant-enabled tables
    const tenant = req.body?.tenant;
    if (tenant) {
      return {
        ...accountability,
        tenant: tenant,
      };
    } else {
      throw new APIError(
        "Tenant is required for importing into tenant-enabled collections. Provide 'tenant' in the request body.",
        400
      );
    }
  }
}

/**
 * Invalidate auth cache for a specific role or all roles
 * Used in: permission.route.ts
 */
export async function invalidateAuthCache(roleId?: string): Promise<void> {
  try {
    const cache = getCache();
    if (roleId) {
      const cacheKey = `auth:role:${roleId}:permissions`;
      await cache.delete(cacheKey);
    } else {
      await cache.invalidateModel("auth");
    }
  } catch (error) {
    console.error(`[Common] Failed to invalidate auth cache:`, error);
  }
}

/**
 * Invalidate cache for a collection
 * Used in: permission.route.ts
 */
export async function invalidateCollectionCache(collection: string): Promise<void> {
  try {
    const cache = getCacheService();
    if (cache) {
      await cache.onMutate({ tables: [collection] });
    }
  } catch (error) {
    console.error(`[Common] Failed to invalidate cache for ${collection}:`, error);
  }
}

/**
 * Invalidate settings cache for a tenant or global
 * Used in: items.route.ts
 * @param corsInvalidator - Function to invalidate CORS cache (from app.ts)
 */
export async function invalidateSettingsCache(
  item: any,
  corsInvalidator?: () => void
): Promise<void> {
  try {
    const tenantId = item?.tenant_Id;
    console.info(`Settings modified - invalidating cache for tenant: ${tenantId || "global"}`);

    if (tenantId) {
      await settingsService.invalidateTenantCache(tenantId);
    } else {
      await settingsService.loadGlobalSettings();
      await settingsService.invalidateAllCaches();
    }

    if (corsInvalidator) {
      corsInvalidator();
    }
  } catch (error: any) {
    console.error("Error invalidating settings cache:", error);
  }
}

/**
 * Invalidate settings cache after import (always invalidates all)
 * Used in: items.route.ts (import-csv and import-json)
 */
export async function invalidateSettingsCacheAfterImport(): Promise<void> {
  console.info(`Settings imported - invalidating all caches`);
  await settingsService.loadGlobalSettings();
  await settingsService.invalidateAllCaches();
}
