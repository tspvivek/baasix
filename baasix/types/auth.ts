/**
 * Authentication Types
 * Centralized authentication and authorization type definitions
 */

/**
 * JWT payload interface
 */
export interface JWTPayload {
  id: string;
  email: string;
  role: string;
  sessionToken: string;
  tenant_Id?: string | number | null;
}

/**
 * User with roles and permissions interface
 */
export interface UserWithRolesAndPermissions {
  id: string | number;
  email?: string;
  roles: string[];
  permissions: string[];
  tenantId?: string | number;
  [key: string]: any;
}

/**
 * Accountability object interface
 */
export interface Accountability {
  user?: { id: string | number };
  role?: { id: string | number; name?: string; isTenantSpecific?: boolean } | string | number;
  tenant?: string | number;
  ipaddress?: string;
}

/**
 * Permission data structure (internal to PermissionService)
 */
export interface PermissionData {
  fields: string[] | null;
  conditions: Record<string, any>;
  relConditions: Record<string, any>;
  defaultValues: Record<string, any>;
}
