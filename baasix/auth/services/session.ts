/**
 * Session Service
 * Handles session management for the auth module
 */

import crypto from "crypto";
import type { AuthAdapter, Session, SessionWithUser, User, Role, Permission, Tenant } from "../types.js";

export interface SessionConfig {
  /**
   * Session expiration time in seconds
   * @default 604800 (7 days)
   */
  expiresIn?: number;
  /**
   * How often to update session (in seconds)
   * @default 86400 (1 day)
   */
  updateAge?: number;
  /**
   * Whether to refresh the session cookie
   * @default true
   */
  cookieRefresh?: boolean;
}

export interface SessionService {
  /**
   * Generate a session token
   */
  generateToken(): string;
  
  /**
   * Create a new session for a user
   */
  createSession(data: {
    user: User;
    tenantId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    type?: string;
  }): Promise<Session>;
  
  /**
   * Validate a session token
   */
  validateSession(token: string): Promise<SessionWithUser | null>;
  
  /**
   * Invalidate a session
   */
  invalidateSession(token: string): Promise<void>;
  
  /**
   * Invalidate all sessions for a user
   */
  invalidateAllSessions(userId: string): Promise<void>;
  
  /**
   * List all sessions for a user
   */
  listSessions(userId: string): Promise<Session[]>;
  
  /**
   * Update session (extend expiration)
   */
  updateSession(sessionId: string): Promise<Session | null>;
  
  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(userId: string): Promise<void>;
  
  /**
   * Count active sessions by type
   */
  countSessionsByType(userId: string, type: string, tenantId?: string | null): Promise<number>;
}

export function createSessionService(adapter: AuthAdapter, config: SessionConfig = {}): SessionService {
  const expiresIn = config.expiresIn ?? 604800; // 7 days default
  const updateAge = config.updateAge ?? 86400; // 1 day default

  return {
    generateToken() {
      return crypto.randomBytes(32).toString("hex");
    },

    async createSession({ user, tenantId, ipAddress, userAgent, type = "default" }) {
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      const session = await adapter.createSession({
        token,
        user_Id: user.id,
        tenant_Id: tenantId || null,
        expiresAt,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        type,
      });

      return session;
    },

    async validateSession(token) {
      const result = await adapter.findSessionByToken(token);
      
      if (!result) {
        return null;
      }

      const { session, user } = result;

      // Check if session has expired
      if (new Date() > new Date(session.expiresAt)) {
        await adapter.deleteSessionByToken(token);
        return null;
      }

      // Check if session needs to be updated (extend expiration)
      const sessionAge = Date.now() - new Date(session.updatedAt || session.createdAt).getTime();
      if (sessionAge > updateAge * 1000) {
        const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
        await adapter.updateSession(session.id, { expiresAt: newExpiresAt });
        session.expiresAt = newExpiresAt;
      }

      return { session, user };
    },

    async invalidateSession(token) {
      await adapter.deleteSessionByToken(token);
    },

    async invalidateAllSessions(userId) {
      await adapter.deleteSessionsByUserId(userId);
    },

    async listSessions(userId) {
      const sessions = await adapter.findSessionsByUserId(userId);
      
      // Filter out expired sessions
      const now = new Date();
      return sessions.filter((s) => new Date(s.expiresAt) > now);
    },

    async updateSession(sessionId) {
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
      return adapter.updateSession(sessionId, { expiresAt: newExpiresAt });
    },

    async cleanupExpiredSessions(userId) {
      const sessions = await adapter.findSessionsByUserId(userId);
      const now = new Date();
      
      for (const session of sessions) {
        if (new Date(session.expiresAt) <= now) {
          await adapter.deleteSession(session.id);
        }
      }
    },

    async countSessionsByType(userId, type, tenantId = null) {
      const sessions = await adapter.findSessionsByUserId(userId);
      const now = new Date();
      
      return sessions.filter((s) => {
        if (new Date(s.expiresAt) <= now) return false;
        if (s.type !== type) return false;
        if (tenantId !== null && s.tenant_Id !== tenantId) return false;
        return true;
      }).length;
    },
  };
}

/**
 * Session Limit Validation
 */
export interface SessionLimitConfig {
  mobile_session_limit?: number;
  web_session_limit?: number;
  session_limit_roles?: string[];
}

// Lazy getter for SettingsService to avoid circular dependency
let _SettingsService: any = null;
async function getSettingsService() {
  if (!_SettingsService) {
    const module = await import('../../services/SettingsService.js');
    _SettingsService = module.default;
  }
  return _SettingsService;
}

// Lazy getter for ItemsService
let _ItemsService: any = null;
async function getItemsService() {
  if (!_ItemsService) {
    const module = await import('../../services/ItemsService.js');
    _ItemsService = module.default || module.ItemsService;
  }
  return _ItemsService;
}

export async function validateSessionLimits(
  sessionService: SessionService,
  userId: string,
  sessionType: string,
  tenantId: string | null = null,
  role: Role | null = null,
  config?: SessionLimitConfig
): Promise<{ isValid: boolean; error?: string }> {
  // Skip validation for 'default' session types
  if (sessionType === "default") {
    return { isValid: true };
  }

  // Validate session type
  if (!["mobile", "web"].includes(sessionType)) {
    return { isValid: false, error: "Invalid session type. Must be 'mobile' or 'web'" };
  }

  // Always skip session limit validation for administrator role
  if (role?.name === "administrator") {
    return { isValid: true };
  }

  try {
    // If no config provided, fetch from SettingsService
    let settings = config;
    if (!settings) {
      const settingsService = await getSettingsService();
      const isMultiTenantEnabled = process.env.MULTI_TENANT === "true";
      
      if (isMultiTenantEnabled && tenantId) {
        settings = await settingsService.getTenantSettings(tenantId);
      } else {
        settings = settingsService.getGlobalSettings();
      }
    }

    if (!settings) {
      return { isValid: true };
    }

    // Get session limit for this type
    const limitKey = `${sessionType}_session_limit` as keyof SessionLimitConfig;
    const sessionLimit = (settings as any)[limitKey] as number | undefined;

    // If no limit is set, allow
    if (sessionLimit === undefined || sessionLimit === null || sessionLimit === -1) {
      return { isValid: true };
    }

    // Check if role is in the session_limit_roles array (if specified)
    const sessionLimitRoles = (settings as any).session_limit_roles;
    if (sessionLimitRoles && Array.isArray(sessionLimitRoles) && sessionLimitRoles.length > 0) {
      if (!role?.id || !sessionLimitRoles.includes(role.id)) {
        return { isValid: true };
      }
    }

    // If limit is 0, don't allow any sessions of this type
    if (sessionLimit === 0) {
      return {
        isValid: false,
        error: `${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} sessions are not allowed`,
      };
    }

    // Count existing sessions using ItemsService directly for accurate counting
    const ItemsService = await getItemsService();
    const sessionsService = new ItemsService('baasix_Sessions', { accountability: undefined });
    
    const filter: any = {
      user_Id: { eq: userId },
      type: { eq: sessionType },
      expiresAt: { gt: new Date().toISOString() }
    };

    const isMultiTenantEnabled = process.env.MULTI_TENANT === "true";
    if (isMultiTenantEnabled && tenantId) {
      filter.tenant_Id = { eq: tenantId };
    }

    const activeSessions = await sessionsService.readByQuery({
      filter,
      limit: -1
    }, true);

    const count = activeSessions.data?.length || 0;

    if (count >= sessionLimit) {
      return {
        isValid: false,
        error: `Maximum ${sessionType} session limit (${sessionLimit}) reached. Please logout from another device.`,
      };
    }

    return { isValid: true };
  } catch (error) {
    console.error("Error validating session limits:", error);
    return { isValid: true };
  }
}

export default createSessionService;
