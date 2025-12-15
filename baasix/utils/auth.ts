/**
 * Authentication utilities for Baasix
 * New implementation using the adapter-based auth module
 * Provides backward compatibility with existing exports
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import env from "./env.js";
import { APIError } from "./errorHandler.js";
import { getSqlClient } from "./db.js";
import { db } from "./db.js";
import { getCache } from "./cache.js";
import { eq, and } from "drizzle-orm";
import { schemaManager } from "./schemaManager.js";
import type { JWTPayload, UserWithRolesAndPermissions } from '../types/index.js';

// Re-export types for backward compatibility
export type { JWTPayload, UserWithRolesAndPermissions };

/**
 * Lazy getter for ItemsService to avoid circular dependency
 */
let _ItemsService: any = null;
async function getItemsService() {
  if (!_ItemsService) {
    const module = await import('../services/ItemsService.js');
    _ItemsService = module.default || module.ItemsService;
  }
  return _ItemsService;
}

// Lazy getter for SettingsService
let _SettingsService: any = null;
async function getSettingsService() {
  if (!_SettingsService) {
    const module = await import('../services/SettingsService.js');
    _SettingsService = module.default;
  }
  return _SettingsService;
}

/**
 * Helper function to get and cache roles and permissions
 * Uses Redis cache with infinite TTL for performance
 */
export async function getRolesAndPermissions(roleId: string | number): Promise<{
  id: string | number;
  name: string;
  description?: string;
  isTenantSpecific?: boolean;
  permissions: Record<string, { action: string; collection: string; fields?: any; conditions?: any }>;
}> {
  const cache = getCache();
  const cacheKey = `auth:role:${roleId}:permissions`;

  // Check cache first
  const cachedRole = await cache.get(cacheKey);
  if (cachedRole) {
    return cachedRole;
  }

  const sql = getSqlClient();

  // Fetch role
  const roles = await sql`
    SELECT id, name, description, "isTenantSpecific"
    FROM "baasix_Role"
    WHERE id = ${roleId}
    LIMIT 1
  `;

  if (roles.length === 0) {
    throw new Error(`Role with id ${roleId} not found`);
  }

  const role = roles[0];

  // Fetch permissions for the role
  const permissions = await sql`
    SELECT id, collection, action, fields, conditions
    FROM "baasix_Permission"
    WHERE "role_Id" = ${roleId}
  `;

  // Transform permissions to object format
  const permissionsObj = permissions.reduce((acc: any, perm: any) => {
    const key = `${perm.collection}_${perm.action}`;
    acc[key] = {
      action: perm.action,
      collection: perm.collection,
      fields: perm.fields,
      conditions: perm.conditions,
    };
    return acc;
  }, {});

  const roleData = {
    id: role.id,
    name: role.name,
    description: role.description,
    isTenantSpecific: role.isTenantSpecific,
    permissions: permissionsObj,
  };

  // Cache role and permissions with infinite TTL
  await cache.set(cacheKey, roleData, -1);
  return roleData;
}

/**
 * Verify JWT token and return decoded payload
 */
export function verifyJWT(token: string): any {
  const secret = env.get("SECRET_KEY") || env.get("JWT_SECRET");
  if (!secret) {
    throw new Error("SECRET_KEY not configured");
  }

  try {
    return jwt.verify(token, secret);
  } catch (error: any) {
    throw new Error(`Invalid token: ${error.message}`);
  }
}

/**
 * Get user with roles, permissions, and tenant information
 */
export async function getUserRolesPermissionsAndTenant(
  userId: string | number,
  tenantId: string | number | null = null
): Promise<{
  role: {
    id: string | number;
    name: string;
    description?: string;
    isTenantSpecific?: boolean;
  };
  permissions: any;
  tenant?: any;
}> {
  try {
    const sql = getSqlClient();

    let userRoles;
    if (tenantId) {
      userRoles = await sql`
        SELECT
          ur.id as "userRoleId",
          ur."user_Id",
          ur."role_Id",
          ur."tenant_Id",
          r.id as "roleId",
          r.name as "roleName",
          r.description as "roleDescription",
          r."isTenantSpecific" as "roleIsTenantSpecific"
        FROM "baasix_UserRole" ur
        LEFT JOIN "baasix_Role" r ON ur."role_Id" = r.id
        WHERE ur."user_Id" = ${userId} AND ur."tenant_Id" = ${tenantId}
        LIMIT 1
      `;
    } else {
      userRoles = await sql`
        SELECT
          ur.id as "userRoleId",
          ur."user_Id",
          ur."role_Id",
          ur."tenant_Id",
          r.id as "roleId",
          r.name as "roleName",
          r.description as "roleDescription",
          r."isTenantSpecific" as "roleIsTenantSpecific"
        FROM "baasix_UserRole" ur
        LEFT JOIN "baasix_Role" r ON ur."role_Id" = r.id
        WHERE ur."user_Id" = ${userId}
        LIMIT 1
      `;
    }

    if (userRoles.length === 0) {
      throw new Error("User role not found");
    }

    const userRole = userRoles[0];

    // Fetch permissions for the role
    const permissions = await sql`
      SELECT
        id,
        collection,
        action,
        fields,
        conditions
      FROM "baasix_Permission"
      WHERE "role_Id" = ${userRole.roleId}
    `;

    // Transform permissions to object format
    const permissionsObj = permissions.reduce((acc: any, perm: any) => {
      const key = `${perm.collection}_${perm.action}`;
      acc[key] = {
        action: perm.action,
        collection: perm.collection,
        fields: perm.fields,
        conditions: perm.conditions,
      };
      return acc;
    }, {});

    // Fetch tenant info if applicable
    let tenant = null;
    if (userRole.tenant_Id) {
      const tenants = await sql`
        SELECT * FROM "baasix_Tenant"
        WHERE id = ${userRole.tenant_Id}
        LIMIT 1
      `;
      tenant = tenants.length > 0 ? tenants[0] : null;
    }

    return {
      role: {
        id: userRole.roleId,
        name: userRole.roleName,
        description: userRole.roleDescription,
        isTenantSpecific: userRole.roleIsTenantSpecific,
      },
      permissions: permissionsObj,
      tenant,
    };
  } catch (error: any) {
    throw new Error(`Error fetching user info: ${error.message}`);
  }
}

/**
 * Generate JWT token for user
 */
export function generateJWT(payload: Record<string, any>, expiresIn: string | number = "7d"): string {
  const secret = env.get("SECRET_KEY");
  if (!secret) {
    throw new Error("SECRET_KEY not configured");
  }

  return jwt.sign(payload, secret, { expiresIn } as any);
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    return parts[1];
  }

  return null;
}

/**
 * Authentication middleware for Express
 * Verifies JWT token and sets req.accountability
 */
export const authMiddleware = async (req: any, res: any, next: any) => {
  try {
    // Extract token from Authorization header, cookie, query param or body
    let token = req.headers.authorization?.replace("Bearer ", "");

    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token && req.query?.access_token) {
      token = req.query.access_token;
    }

    if (!token && req.body?.access_token) {
      token = req.body.access_token;
    }

    if (!token) {
      // No token provided - treat as public access
      req.accountability = {
        user: null,
        role: { id: null, name: "public" },
        tenant: null,
        permissions: [],
        ipaddress: req.ip || req.connection?.remoteAddress,
      };
      return next();
    }

    // Verify JWT token
    const payload = jwt.verify(token, env.get("SECRET_KEY") as string) as JWTPayload;

    // Validate session
    const session = await validateSession(payload.sessionToken, payload.tenant_Id?.toString() || null);
    if (!session) {
      return res.status(401).json({ code: "INVALID_SESSION", message: "Invalid or expired session" });
    }

    // Get dynamically created tables from schema manager
    const userTable = schemaManager.getTable("baasix_User");
    const userRoleTable = schemaManager.getTable("baasix_UserRole");
    const roleTable = schemaManager.getTable("baasix_Role");
    const permissionTable = schemaManager.getTable("baasix_Permission");

    // Get user details with role
    let users;
    if (payload.tenant_Id !== undefined && payload.tenant_Id !== null) {
      users = await db
        .select({
          id: userTable.id,
          email: userTable.email,
          firstName: userTable.firstName,
          lastName: userTable.lastName,
          role_Id: userRoleTable.role_Id,
          tenant_Id: userRoleTable.tenant_Id,
        })
        .from(userTable)
        .leftJoin(userRoleTable, eq(userTable.id, userRoleTable.user_Id))
        .where(and(
          eq(userTable.id, payload.id),
          eq(userRoleTable.tenant_Id, payload.tenant_Id)
        ))
        .limit(1);
    } else {
      users = await db
        .select({
          id: userTable.id,
          email: userTable.email,
          firstName: userTable.firstName,
          lastName: userTable.lastName,
          role_Id: userRoleTable.role_Id,
          tenant_Id: userRoleTable.tenant_Id,
        })
        .from(userTable)
        .leftJoin(userRoleTable, eq(userTable.id, userRoleTable.user_Id))
        .where(eq(userTable.id, payload.id))
        .limit(1);
    }

    if (!users || users.length === 0) {
      req.accountability = {
        user: null,
        role: { id: null, name: "public" },
        tenant: null,
        permissions: [],
        ipaddress: req.ip || req.connection?.remoteAddress,
      };
      return next();
    }

    const user = users[0];

    // Get role and permissions from cache or database
    let role: any = { id: null, name: "user", isTenantSpecific: false };
    let permissions: any[] = [];

    if (user.role_Id) {
      try {
        const roleData = await getRolesAndPermissions(user.role_Id);
        role = {
          id: roleData.id,
          name: roleData.name,
          isTenantSpecific: roleData.isTenantSpecific,
        };
        permissions = Object.values(roleData.permissions);
      } catch {
        const roles = await db
          .select({
            id: roleTable.id,
            name: roleTable.name,
            isTenantSpecific: roleTable.isTenantSpecific
          })
          .from(roleTable)
          .where(eq(roleTable.id, user.role_Id))
          .limit(1);

        if (roles && roles.length > 0) {
          role = roles[0];
        }

        permissions = await db
          .select()
          .from(permissionTable)
          .where(eq(permissionTable.role_Id, user.role_Id));
      }
    }

    // Calculate isAdmin based on role name
    const isAdmin = role.name === 'administrator';

    // Set accountability object
    req.accountability = {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: isAdmin,
        role: role.name,
      } as any,
      role: role as any,
      tenant: user.tenant_Id || null,
      permissions: permissions || [],
      ipaddress: req.ip || req.connection?.remoteAddress,
    };

    next();
  } catch (error: any) {
    console.error('Auth middleware error:', error.message);
    req.accountability = {
      user: null,
      role: { id: null, name: "public" },
      tenant: null,
      permissions: [],
      ipaddress: req.ip || req.connection?.remoteAddress,
    };
    next();
  }
};

/**
 * Helper function to check if user is an administrator
 */
export const isAdmin = (req: any): boolean => {
  return req.accountability?.role?.name === "administrator" || req.accountability?.user?.isAdmin === true;
};

/**
 * Middleware to check for admin access
 */
export const adminOnly = (req: any, res: any, next: any) => {
  if (!isAdmin(req)) {
    return next(new APIError("Access denied. Administrators only.", 403));
  }
  next();
};

/**
 * Create a session in the database
 */
export async function createSession(
  user: any,
  expiresInSeconds: number,
  sessionType: string = "default",
  tenantId: string | null = null
): Promise<string> {
  const ItemsService = await getItemsService();
  const sessionService = new ItemsService('baasix_Sessions');

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await sessionService.createOne({
    token: sessionToken,
    user_Id: user.id,
    type: sessionType,
    expiresAt,
    tenant_Id: tenantId,
  });

  return sessionToken;
}

/**
 * Validate a session token
 */
export async function validateSession(
  token: string,
  expectedTenantId: string | null = null
): Promise<any> {
  const ItemsService = await getItemsService();
  const sessionService = new ItemsService('baasix_Sessions');

  const sessions = await sessionService.readByQuery({
    filter: { token: { eq: token } },
    limit: 1,
  });

  if (!sessions.data || sessions.data.length === 0) {
    return null;
  }

  const session = sessions.data[0];

  // Check if session has expired
  if (new Date() > new Date(session.expiresAt)) {
    await sessionService.deleteOne(session.id);
    return null;
  }

  // Optional tenant validation for enhanced security
  const isMultiTenant = env.get("MULTI_TENANT") === "true";
  if (isMultiTenant && expectedTenantId !== null && expectedTenantId !== undefined && session.tenant_Id !== expectedTenantId) {
    console.warn(`Session tenant mismatch: expected ${expectedTenantId}, got ${session.tenant_Id}`);
  }

  return session;
}

/**
 * Validate session limits for a user
 */
export async function validateSessionLimits(
  userId: string,
  sessionType: string,
  tenantId: string | null = null,
  role: { id: string | number; name: string } | null = null
): Promise<{ isValid: boolean; error?: string }> {
  if (sessionType === "default") {
    return { isValid: true };
  }

  if (!["mobile", "web"].includes(sessionType)) {
    return { isValid: false, error: "Invalid session type. Must be 'mobile' or 'web'" };
  }

  if (role?.name === "administrator") {
    return { isValid: true };
  }

  try {
    const settingsService = await getSettingsService();
    const ItemsService = await getItemsService();

    const isMultiTenantEnabled = env.get("MULTI_TENANT") === "true";
    let settings;
    if (isMultiTenantEnabled && tenantId) {
      settings = await settingsService.getTenantSettings(tenantId);
    } else {
      settings = settingsService.getGlobalSettings();
    }

    if (!settings) {
      return { isValid: true };
    }

    const limitKey = `${sessionType}_session_limit`;
    const sessionLimit = (settings as any)[limitKey];

    if (sessionLimit === undefined || sessionLimit === null || sessionLimit === -1) {
      return { isValid: true };
    }

    const sessionLimitRoles = (settings as any).session_limit_roles;
    if (sessionLimitRoles && Array.isArray(sessionLimitRoles) && sessionLimitRoles.length > 0) {
      if (!role?.id || !sessionLimitRoles.includes(role.id)) {
        return { isValid: true };
      }
    }

    if (sessionLimit === 0) {
      return {
        isValid: false,
        error: `${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} sessions are not allowed`
      };
    }

    const sessionService = new ItemsService('baasix_Sessions');
    const filter: any = {
      user_Id: userId,
      type: sessionType,
      expiresAt: { gt: new Date().toISOString() }
    };

    if (isMultiTenantEnabled && tenantId) {
      filter.tenant_Id = tenantId;
    }

    const activeSessions = await sessionService.readByQuery({
      filter,
      limit: -1
    }, true);

    if (activeSessions.data.length >= sessionLimit) {
      return {
        isValid: false,
        error: `Maximum ${sessionType} session limit (${sessionLimit}) reached. Please logout from another device.`
      };
    }

    return { isValid: true };
  } catch (error) {
    console.error("Error validating session limits:", error);
    return { isValid: true };
  }
}

/**
 * Generate token with session creation
 */
export async function generateToken(
  user: any,
  role: any,
  tenant: any = null,
  ip: string | null = null,
  sessionType: string = "default"
): Promise<string> {
  const expiresIn = parseInt(env.get("ACCESS_TOKEN_EXPIRES_IN") || "3600");
  const sessionToken = await createSession(user, expiresIn, sessionType, tenant?.id);

  const payload: any = {
    id: user.id,
    role_Id: role.id,
    sessionToken,
  };

  if (tenant) {
    payload.tenant_Id = tenant.id;
  }

  // Add audit log for login
  try {
    const ItemsService = await getItemsService();
    const auditService = new ItemsService('baasix_AuditLog');
    await auditService.createOne({
      type: "auth",
      action: "login",
      entity: "baasix_User",
      entityId: user.id,
      userId: user.id,
      ipaddress: ip,
      tenant_Id: tenant?.id,
    });
  } catch (error) {
    console.error("Error creating audit log:", error);
  }

  return generateJWT(payload, `${expiresIn}s`);
}

export default authMiddleware;
