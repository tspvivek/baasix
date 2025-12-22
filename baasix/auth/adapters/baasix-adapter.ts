/**
 * Baasix Adapter for Auth Module
 * Uses ItemsService to interact with the database
 */

import type {
  AuthAdapter,
} from "../types.js";

// Lazy import for PermissionService to avoid circular dependencies
let _permissionService: any = null;
async function getPermissionService() {
  if (!_permissionService) {
    const module = await import("../../services/PermissionService.js");
    _permissionService = module.permissionService;
  }
  return _permissionService;
}

/**
 * Create a Baasix adapter for the auth module
 * This adapter uses ItemsService for database operations
 */
export function createBaasixAdapter(): AuthAdapter {
  // Lazy import to avoid circular dependencies
  let _ItemsService: any = null;
  
  async function getItemsService() {
    if (!_ItemsService) {
      const module = await import("../../services/ItemsService.js");
      _ItemsService = module.default || module.ItemsService;
    }
    return _ItemsService;
  }
  
  async function getService(collection: string) {
    const ItemsService = await getItemsService();
    return new ItemsService(collection, { accountability: undefined });
  }

  return {
    // ==================== User Operations ====================
    
    async createUser(user) {
      const service = await getService("baasix_User");
      const id = await service.createOne(user);
      return service.readOne(id);
    },

    async findUserById(userId) {
      const service = await getService("baasix_User");
      try {
        const user = await service.readOne(userId);
        return user || null;
      } catch {
        return null;
      }
    },

    async findUserByEmail(email) {
      const service = await getService("baasix_User");
      const result = await service.readByQuery({
        filter: { email: { eq: email.toLowerCase() } },
        limit: 1,
      });
      return result.data?.[0] || null;
    },

    async updateUser(userId, data) {
      const service = await getService("baasix_User");
      await service.updateOne(userId, data);
      return service.readOne(userId);
    },

    async deleteUser(userId) {
      const service = await getService("baasix_User");
      await service.deleteOne(userId);
    },

    // ==================== Account Operations ====================

    async createAccount(account) {
      const service = await getService("baasix_Account");
      const id = await service.createOne(account);
      return service.readOne(id);
    },

    async findAccountByProvider(providerId, accountId) {
      const service = await getService("baasix_Account");
      const result = await service.readByQuery({
        filter: {
          providerId: { eq: providerId },
          accountId: { eq: accountId },
        },
        limit: 1,
      });
      return result.data?.[0] || null;
    },

    async findAccountsByUserId(userId) {
      const service = await getService("baasix_Account");
      const result = await service.readByQuery({
        filter: { user_Id: { eq: userId } },
      });
      return result.data || [];
    },

    async updateAccount(accountId, data) {
      const service = await getService("baasix_Account");
      await service.updateOne(accountId, data);
      return service.readOne(accountId);
    },

    async deleteAccount(accountId) {
      const service = await getService("baasix_Account");
      await service.deleteOne(accountId);
    },

    async deleteAccountsByUserId(userId) {
      const service = await getService("baasix_Account");
      const accounts = await service.readByQuery({
        filter: { user_Id: { eq: userId } },
      });
      if (accounts.data) {
        for (const account of accounts.data) {
          await service.deleteOne(account.id);
        }
      }
    },

    // ==================== Session Operations ====================

    async createSession(session) {
      const service = await getService("baasix_Sessions");
      const id = await service.createOne(session);
      return service.readOne(id);
    },

    async findSessionByToken(token) {
      const sessionService = await getService("baasix_Sessions");
      const result = await sessionService.readByQuery({
        filter: { token: { eq: token } },
        fields: ["*", "user.*"],
        limit: 1,
      });
      
      if (!result.data?.[0]) {
        return null;
      }
      
      const session = result.data[0];
      
      // If user wasn't populated, fetch it
      if (!session.user || typeof session.user === "string") {
        const userService = await getService("baasix_User");
        const user = await userService.readOne(session.user_Id);
        if (!user) return null;
        return { session, user };
      }
      
      return { session, user: session.user };
    },

    async findSessionsByUserId(userId) {
      const service = await getService("baasix_Sessions");
      const result = await service.readByQuery({
        filter: { user_Id: { eq: userId } },
      });
      return result.data || [];
    },

    async updateSession(sessionId, data) {
      const service = await getService("baasix_Sessions");
      await service.updateOne(sessionId, data);
      return service.readOne(sessionId);
    },

    async deleteSession(sessionId) {
      const service = await getService("baasix_Sessions");
      await service.deleteOne(sessionId);
    },

    async deleteSessionByToken(token) {
      const service = await getService("baasix_Sessions");
      const result = await service.readByQuery({
        filter: { token: { eq: token } },
        limit: 1,
      });
      if (result.data?.[0]) {
        await service.deleteOne(result.data[0].id);
      }
    },

    async deleteSessionsByUserId(userId) {
      const service = await getService("baasix_Sessions");
      const sessions = await service.readByQuery({
        filter: { user_Id: { eq: userId } },
      });
      if (sessions.data) {
        for (const session of sessions.data) {
          await service.deleteOne(session.id);
        }
      }
    },

    // ==================== Verification Operations ====================

    async createVerification(verification) {
      const service = await getService("baasix_Verification");
      const id = await service.createOne(verification);
      return service.readOne(id);
    },

    async findVerificationByIdentifier(identifier) {
      const service = await getService("baasix_Verification");
      const result = await service.readByQuery({
        filter: { identifier: { eq: identifier } },
        limit: 1,
      });
      return result.data?.[0] || null;
    },

    async deleteVerification(verificationId) {
      const service = await getService("baasix_Verification");
      await service.deleteOne(verificationId);
    },

    async deleteVerificationByIdentifier(identifier) {
      const service = await getService("baasix_Verification");
      const result = await service.readByQuery({
        filter: { identifier: { eq: identifier } },
      });
      if (result.data) {
        for (const verification of result.data) {
          await service.deleteOne(verification.id);
        }
      }
    },

    // ==================== Role Operations ====================

    async findRoleByName(name) {
      // Try PermissionService hybrid cache first
      const permissionService = await getPermissionService();
      const cachedRole = await permissionService.getRoleByNameAsync(name);
      if (cachedRole) {
        return cachedRole;
      }
      
      // Fallback to database query
      const service = await getService("baasix_Role");
      const result = await service.readByQuery({
        filter: { name: { eq: name } },
        limit: 1,
      });
      return result.data?.[0] || null;
    },

    async findRoleById(roleId) {
      // Try PermissionService hybrid cache first
      const permissionService = await getPermissionService();
      const cachedRole = await permissionService.getRoleByIdAsync(roleId);
      if (cachedRole) {
        return cachedRole;
      }
      
      // Fallback to database query
      const service = await getService("baasix_Role");
      try {
        return await service.readOne(roleId);
      } catch {
        return null;
      }
    },

    // ==================== UserRole Operations ====================

    async createUserRole(userRole) {
      const service = await getService("baasix_UserRole");
      const id = await service.createOne(userRole);
      return service.readOne(id);
    },

    async findUserRolesByUserId(userId, tenantId = null) {
      const service = await getService("baasix_UserRole");
      const filter: any = { user_Id: { eq: userId } };
      
      if (tenantId !== null && tenantId !== undefined) {
        filter.tenant_Id = { eq: tenantId };
      }
      
      const result = await service.readByQuery({
        filter,
        fields: ["*", "role.*"],
      });
      
      return result.data || [];
    },

    async deleteUserRolesByUserId(userId) {
      const service = await getService("baasix_UserRole");
      const userRoles = await service.readByQuery({
        filter: { user_Id: { eq: userId } },
      });
      if (userRoles.data) {
        for (const userRole of userRoles.data) {
          await service.deleteOne(userRole.id);
        }
      }
    },

    // ==================== Permission Operations ====================

    async findPermissionsByRoleId(roleId) {
      const service = await getService("baasix_Permission");
      const result = await service.readByQuery({
        filter: { role_Id: { eq: roleId } },
      });
      return result.data || [];
    },

    // ==================== Tenant Operations ====================

    async findTenantById(tenantId) {
      const service = await getService("baasix_Tenant");
      try {
        return await service.readOne(tenantId);
      } catch {
        return null;
      }
    },

    async createTenant(tenant) {
      const service = await getService("baasix_Tenant");
      const id = await service.createOne(tenant);
      return service.readOne(id);
    },

    // ==================== Invite Operations ====================

    async findInviteByToken(token) {
      const service = await getService("baasix_Invite");
      const result = await service.readByQuery({
        filter: {
          token: { eq: token },
          status: { eq: "pending" },
          expiresAt: { gt: new Date().toISOString() },
        },
        fields: ["*", "role.*", "tenant.*"],
        limit: 1,
      });
      return result.data?.[0] || null;
    },

    async updateInviteStatus(inviteId, status) {
      const service = await getService("baasix_Invite");
      await service.updateOne(inviteId, { status });
    },
  };
}

export default createBaasixAdapter;
