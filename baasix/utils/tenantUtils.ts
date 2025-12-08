import env from "./env.js";
import { APIError } from "./errorHandler.js";

// Use TENANT_IGNORED_TABLES from .env file to determine which collections are not tenant-specific
const tenantIgnoredTablesString = env.get("TENANT_IGNORED_TABLES");
const tenantIgnoredTables = tenantIgnoredTablesString
  ? tenantIgnoredTablesString.split(",").map((table: string) => table.trim())
  : [];

// List of system collections that are tenant-specific
const tenantSpecificSystemCollections = [
  "baasix_Sessions",
  "baasix_File",
  "baasix_AuditLog",
  "baasix_User",
  "baasix_UserRole",
  "baasix_Tasks",
  "baasix_Workflow",
  "baasix_WorkflowExecution",
  "baasix_WorkflowExecutionLog",
];

// Collections that support public access bypass (isPublic field)
const publicAccessCollections = ["baasix_File"];

/**
 * Determines whether tenant context should be enforced for the current operation
 * @param service - The service instance
 * @returns Whether tenant context should be enforced
 */
export async function shouldEnforceTenantContext(service: any): Promise<boolean> {
  // Skip tenant enforcement for system collections
  if (service.collection.startsWith("baasix_") && !tenantSpecificSystemCollections.includes(service.collection)) {
    return false;
  }

  // Skip tenant enforcement for collections that are explicitly ignored
  if (tenantIgnoredTables.includes(service.collection)) {
    return false;
  }

  // Always enforce if multi-tenancy is enabled and we have accountability
  if (!service.isMultiTenant || !service.accountability) {
    return false;
  }

  // Check if the role is tenant-specific
  return service.accountability.role?.isTenantSpecific === true || service.tenant;
}

/**
 * Check if collection supports public access bypass
 * @param collection - The collection name
 * @returns Whether the collection supports isPublic field
 */
export function supportsPublicAccess(collection: string): boolean {
  return publicAccessCollections.includes(collection);
}

/**
 * Builds a tenant filter that includes public access bypass for supported collections
 * @param collection - The collection name
 * @param tenantId - The tenant ID
 * @returns The tenant filter object
 */
export function buildTenantFilter(collection: string, tenantId: string | number): any {
  // For collections that support public access, add OR condition with isPublic: true
  if (supportsPublicAccess(collection)) {
    return {
      OR: [
        { tenant_Id: tenantId },
        { isPublic: true }
      ]
    };
  }

  // For baasix_User, use userRoles.tenant_Id
  if (collection === "baasix_User") {
    return { "userRoles.tenant_Id": tenantId };
  }

  // Default tenant filter
  return { tenant_Id: tenantId };
}

/**
 * Enforces tenant context in database queries
 * @param query - The query object
 * @param service - The service instance
 * @returns The modified query with tenant context
 */
export async function enforceTenantContext(query: any = {}, service: any): Promise<any> {
  if (!(await shouldEnforceTenantContext(service))) {
    return query;
  }

  if (!service.accountability.tenant) {
    throw new APIError("No tenant context available for tenant-specific operation", 403);
  }

  // Build tenant filter using helper (handles isPublic bypass for supported collections)
  const tenantFilter = buildTenantFilter(service.collection, service.accountability.tenant);

  query = query || {};

  query.filter = query.filter
    ? {
        AND: [query.filter, tenantFilter],
      }
    : tenantFilter;

  return query;
}

/**
 * Validates and enforces tenant context in data objects
 * @param data - The data object
 * @param service - The service instance
 * @returns The validated and potentially modified data object
 */
export async function validateTenantContext(data: any, service: any): Promise<any> {
  if (!(await shouldEnforceTenantContext(service))) {
    return data;
  }

  // For collection "baasix_User", tenant_Id is not set in the data object
  if (service.collection === "baasix_User") {
    return data;
  }

  if (!service.accountability.tenant) {
    throw new APIError("No tenant context available for tenant-specific operation", 403);
  }

  // Ensure tenant_Id matches the current tenant
  if (data.tenant_Id && data.tenant_Id !== service.accountability.tenant) {
    throw new APIError("Cannot operate on data from different tenant", 403);
  }

  // Set tenant_Id for create/update operations
  return {
    ...data,
    tenant_Id: service.accountability.tenant,
  };
}
