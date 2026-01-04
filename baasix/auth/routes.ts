/**
 * Auth Route Handler
 * Express routes for the auth module
 */

import type { Express, Request, Response, NextFunction } from "express";
import type { BaasixAuth } from "./core.js";
import type { AuthOptions } from "./types.js";
import { createAuth } from "./core.js";
import { getCache } from "../utils/cache.js";
import { isAdmin, getPublicRole } from "../utils/auth.js";

// Store OAuth state in cache for validation
const OAUTH_STATE_PREFIX = "oauth_state:";
const OAUTH_STATE_TTL = 600; // 10 minutes

/**
 * Helper function to set token in response based on auth mode
 */
export const setTokenInResponse = (
  res: Response,
  token: string,
  authMode: string,
  env?: { get: (key: string) => string | undefined }
): { token?: string; message?: string; authMode: string } => {
  if (authMode === "cookie") {
    // Get cookie settings from environment variables with secure defaults
    const secureEnv = env?.get("AUTH_COOKIE_SECURE");
    const cookieOptions: any = {
      httpOnly: env?.get("AUTH_COOKIE_HTTP_ONLY") !== "false", // Default: true (secure)
      secure: secureEnv !== undefined ? secureEnv === "true" : env?.get("NODE_ENV") === "production", // Explicit value or default to true in production
      sameSite: env?.get("AUTH_COOKIE_SAME_SITE") || (env?.get("NODE_ENV") === "production" ? "strict" : "lax"), // Default: strict in prod, lax in dev
      maxAge: (parseInt(env?.get("ACCESS_TOKEN_EXPIRES_IN") || "604800") || 604800) * 1000, // Default 7 days
      path: env?.get("AUTH_COOKIE_PATH") || "/", // Default: all paths
    };

    // Add domain if specified in environment
    if (env?.get("AUTH_COOKIE_DOMAIN")) {
      cookieOptions.domain = env.get("AUTH_COOKIE_DOMAIN");
    }

    res.cookie("token", token, cookieOptions);
    return { token, message: "Authentication successful", authMode: "cookie" };
  } else {
    // For 'jwt' mode or if not specified, send token in response body
    return { token, authMode: "jwt" };
  }
};

export interface AuthRouteOptions extends AuthOptions {
  /**
   * Base path for auth routes
   * @default "/auth"
   */
  basePath?: string;
  /**
   * Mail service for sending emails
   */
  mailService?: {
    sendMail: (options: {
      to: string;
      subject: string;
      templateName: string;
      context: Record<string, any>;
    }) => Promise<void>;
  };
  /**
   * Settings service for getting app URLs
   */
  settingsService?: {
    getAllSettingsUrls: () => Promise<string[]>;
    getTenantSettings?: (tenantId: string) => Promise<any>;
    getGlobalSettings?: () => any;
  };
  /**
   * Env helper
   */
  env?: {
    get: (key: string) => string | undefined;
  };
}

// Note: Express Request is augmented in utils/auth.v2.ts
// The 'auth' and 'accountability' properties are added there

/**
 * Create auth routes for Express
 */
export function createAuthRoutes(app: Express, options: AuthRouteOptions): BaasixAuth {
  const basePath = options.basePath || "/auth";
  const auth = createAuth(options);
  const cache = getCache();
  
  // Helper to get allowed app URLs
  async function getAllowedAppUrls(): Promise<string[]> {
    try {
      const staticUrls = options.env?.get("AUTH_APP_URL")?.split(",").map((url) => url.trim()) || [];
      const dynamicUrls = options.settingsService 
        ? await options.settingsService.getAllSettingsUrls()
        : [];
      return [...new Set([...staticUrls, ...dynamicUrls])];
    } catch (error) {
      console.error("Error getting allowed app URLs:", error);
      return options.env?.get("AUTH_APP_URL")?.split(",").map((url) => url.trim()) || [];
    }
  }
  
  // Helper to validate URL
  async function isValidAppUrl(url: string | undefined): Promise<boolean> {
    if (!url) return false;
    const allowedUrls = await getAllowedAppUrls();
    return allowedUrls.includes(url);
  }
  
  // Helper to store OAuth state
  async function storeOAuthState(state: string, data: { codeVerifier: string; redirectURI: string; authMode?: string }) {
    await cache.set(`${OAUTH_STATE_PREFIX}${state}`, data, OAUTH_STATE_TTL);
  }
  
  // Helper to get and delete OAuth state
  async function getOAuthState(state: string): Promise<{ codeVerifier: string; redirectURI: string; authMode?: string } | null> {
    const data = await cache.get(`${OAUTH_STATE_PREFIX}${state}`);
    if (data) {
      await cache.delete(`${OAUTH_STATE_PREFIX}${state}`);
    }
    return data;
  }
  
  // ==================== Registration ====================
  
  app.post(`${basePath}/register`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, firstName, lastName, phone, tenant, roleName, inviteToken, authMode = "jwt" } = req.body;

      if (!email || !password || !firstName) {
        return res.status(400).json({ message: "Email, password, and firstName are required" });
      }

      const ipAddress = req.ip || (req.connection as any)?.remoteAddress || null;
      const userAgent = req.headers["user-agent"] || null;

      const result = await auth.signUp({
        email,
        password,
        firstName,
        lastName,
        phone,
        tenant,
        roleName,
        inviteToken,
        ipAddress,
        userAgent,
      });
      
      // Check if email verification is required
      if (result.requiresEmailVerification) {
        // Don't send token - user needs to verify email first
        return res.json({
          message: "User registered successfully. Please verify your email to login.",
          requiresEmailVerification: true,
          user: {
            id: result.user.id,
            email: result.user.email,
            firstName: result.user.firstName,
            lastName: result.user.lastName,
          },
          role: result.role,
          permissions: result.permissions,
          tenant: result.tenant,
        });
      }
      
      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, result.token, authMode, options.env);
      
      res.json({
        message: "User registered successfully",
        ...tokenResponse,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
        },
        role: result.role,
        permissions: result.permissions,
        tenant: result.tenant,
      });
    } catch (error: any) {
      if (error.message === "User already exists") {
        return res.status(400).json({ message: error.message });
      }
      if (error.message.includes("Tenant information is required")) {
        return res.status(400).json({ message: error.message });
      }
      if (error.message.includes("Invalid or expired invitation")) {
        return res.status(400).json({ message: error.message });
      }
      if (error.message.includes("email address doesn't match")) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  
  // ==================== Login ====================
  
  app.post(`${basePath}/login`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, tenant_Id, authType, authMode = "jwt" } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const ipAddress = req.ip || (req.connection as any)?.remoteAddress || null;
      const userAgent = req.headers["user-agent"] || null;

      const result = await auth.signIn({
        email,
        password,
        tenant_Id,
        authType,
        ipAddress,
        userAgent,
      });
      
      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, result.token, authMode, options.env);
      
      res.json({
        ...tokenResponse,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
        },
        role: result.role,
        permissions: result.permissions,
        tenant: result.tenant,
      });
    } catch (error: any) {
      if (error.message === "Invalid credentials") {
        return res.status(400).json({ message: "Incorrect password." });
      }
      if (error.message.includes("Email not verified")) {
        return res.status(403).json({ message: error.message, requiresEmailVerification: true });
      }
      if (error.message.includes("Account is")) {
        return res.status(403).json({ message: error.message });
      }
      if (error.message.includes("session limit") || error.message.includes("sessions are not allowed")) {
        return res.status(403).json({ message: error.message });
      }
      if (error.message.includes("Invalid session type")) {
        return res.status(403).json({ message: error.message });
      }
      next(error);
    }
  });
  
  // ==================== Get Current User ====================
  
  app.get(`${basePath}/me`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await auth.getUserById((req.accountability.user as any).id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Update last access
      await auth.updateUser(user.id, { lastAccess: new Date() });
      
      res.json({
        user,
        role: req.accountability.role,
        permissions: req.accountability.permissions,
        tenant: req.accountability.tenant,
      });
    } catch (error) {
      next(error);
    }
  });
  
  // ==================== Logout ====================
  
  app.get(`${basePath}/logout`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;
      
      if (token) {
        await auth.invalidateSession(token);
      }
      
      res.clearCookie("token");
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      next(error);
    }
  });
  
  // ==================== Social Sign In ====================
  
  app.post(`${basePath}/social/signin`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider, callbackURL, errorCallbackURL, scopes, idToken, authMode = "jwt" } = req.body;
      
      if (!provider) {
        return res.status(400).json({ message: "Provider is required" });
      }
      
      // If ID token is provided, handle direct sign-in
      if (idToken?.token) {
        const providerInstance = auth.providers.get(provider);
        if (!providerInstance) {
          return res.status(400).json({ message: `Provider '${provider}' not found` });
        }
        
        // Verify ID token if provider supports it
        if (providerInstance.verifyIdToken) {
          const isValid = await providerInstance.verifyIdToken(idToken.token, idToken.nonce);
          if (!isValid) {
            return res.status(400).json({ message: "Invalid ID token" });
          }
        }
        
        // Get user info from ID token
        const tokens = {
          idToken: idToken.token,
          accessToken: idToken.accessToken,
          refreshToken: idToken.refreshToken,
        };
        
        const userInfo = await providerInstance.getUserInfo(tokens);
        if (!userInfo) {
          return res.status(400).json({ message: "Failed to get user info from token" });
        }
        
        // Handle OAuth user (create or update)
        // This is simplified - in production you'd want to reuse handleOAuthCallback logic
        const result = await auth.handleOAuthCallback(
          provider,
          "", // no code needed
          "", // no state needed
          "", // no code verifier needed
          ""  // no redirect URI needed
        );
        
        // Set token in response based on authMode
        const tokenResponse = setTokenInResponse(res, result.token, authMode, options.env);
        
        return res.json({
          redirect: false,
          ...tokenResponse,
          user: result.user,
        });
      }
      
      // Generate OAuth URL
      const redirectURI = callbackURL || `${options.baseURL || ""}${basePath}/callback/${provider}`;
      
      const { url, state, codeVerifier } = await auth.getOAuthUrl(provider, redirectURI, scopes);
      
      // Store state for verification (including authMode for callback)
      await storeOAuthState(state, { codeVerifier, redirectURI, authMode });
      
      res.json({
        redirect: true,
        url,
      });
    } catch (error: any) {
      if (error.message.includes("not found")) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  
  // ==================== OAuth Callback ====================
  
  app.get(`${basePath}/callback/:provider`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider } = req.params;
      const { code, state, error, error_description } = req.query;
      
      // Handle OAuth error
      if (error) {
        return res.status(400).json({ 
          message: error_description || error || "OAuth authentication failed" 
        });
      }
      
      if (!code || !state) {
        return res.status(400).json({ message: "Missing code or state parameter" });
      }
      
      // Get stored state data
      const stateData = await getOAuthState(state as string);
      if (!stateData) {
        return res.status(400).json({ message: "Invalid or expired state" });
      }
      
      const { codeVerifier, redirectURI, authMode = "jwt" } = stateData;
      
      const result = await auth.handleOAuthCallback(
        provider,
        code as string,
        state as string,
        codeVerifier,
        redirectURI
      );
      
      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, result.token, authMode, options.env);
      
      // Return JSON response with token
      res.json({
        ...tokenResponse,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
        },
        role: result.role,
        permissions: result.permissions,
        tenant: result.tenant,
      });
    } catch (error) {
      next(error);
    }
  });
  
  // Apple Sign In POST callback (Apple sends POST with form data)
  app.post(`${basePath}/callback/apple`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, state, error, id_token, user } = req.body;
      
      if (error) {
        return res.status(400).json({ message: "Apple authentication failed" });
      }
      
      if (!code || !state) {
        return res.status(400).json({ message: "Missing code or state parameter" });
      }
      
      // Get stored state data
      const stateData = await getOAuthState(state);
      if (!stateData) {
        return res.status(400).json({ message: "Invalid or expired state" });
      }
      
      const { codeVerifier, redirectURI, authMode = "jwt" } = stateData;
      
      const result = await auth.handleOAuthCallback(
        "apple",
        code,
        state,
        codeVerifier,
        redirectURI
      );
      
      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, result.token, authMode, options.env);
      
      res.json({
        ...tokenResponse,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
        },
        role: result.role,
        permissions: result.permissions,
        tenant: result.tenant,
      });
    } catch (error) {
      next(error);
    }
  });
  
  // ==================== Magic Link ====================
  
  app.post(`${basePath}/magiclink`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, link, mode = "link" } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      if (mode === "link" && !(await isValidAppUrl(link))) {
        return res.status(400).json({ message: "Invalid link" });
      }
      
      // Check if user exists
      const user = await auth.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Create magic link token
      const { token, expiresAt } = await auth.createMagicLink(email);
      
      // Send email
      if (options.mailService) {
        if (mode === "link") {
          const magicLinkUrl = `${link}/auth/magiclink/${token}`;
          
          await options.mailService.sendMail({
            to: email,
            subject: "Sign in to Your App",
            templateName: "magicLinkUrl",
            context: {
              magicLinkUrl,
              name: user.firstName || user.email,
            },
          });
        } else if (mode === "code") {
          // For code mode, generate a short code and store it separately
          const code = token.substring(0, 12).toUpperCase();
          // Update the verification to store the code as the value
          await auth.updateMagicLinkToken(email, code);
          
          await options.mailService.sendMail({
            to: email,
            subject: "Sign in to Your App",
            templateName: "magicLinkCode",
            context: {
              code,
              name: user.firstName || user.email,
            },
          });
        }
      }
      
      res.json({ message: "Instruction sent to your email" });
    } catch (error) {
      next(error);
    }
  });
  
  app.get(`${basePath}/magiclink/:token`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params;
      const authMode = (req.query.authMode as string) || "jwt";
      
      const result = await auth.verifyMagicLink(token);
      if (!result) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }
      
      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, result.token, authMode, options.env);
      
      res.json({
        ...tokenResponse,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
        },
      });
    } catch (error) {
      next(error);
    }
  });
  
  // ==================== Password Reset ====================
  
  app.post(`${basePath}/password/reset`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, link } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      if (!(await isValidAppUrl(link))) {
        return res.status(400).json({ message: "Invalid link" });
      }
      
      // Check if user exists
      const user = await auth.getUserByEmail(email);
      if (!user) {
        // Don't reveal if user exists
        return res.json({ message: "If an account exists, a reset link will be sent" });
      }
      
      // Create reset token
      const { token, expiresAt } = await auth.createPasswordReset(email);
      
      // Send email
      if (options.mailService) {
        const resetUrl = `${link}/auth/reset-password/${token}`;
        
        await options.mailService.sendMail({
          to: email,
          subject: "Reset Your Password",
          templateName: "passwordReset",
          context: {
            resetUrl,
            name: user.firstName || user.email,
            expiresAt: expiresAt.toISOString(),
          },
        });
      }
      
      res.json({ message: "If an account exists, a reset link will be sent" });
    } catch (error) {
      next(error);
    }
  });
  
  app.post(`${basePath}/password/reset/:token`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params;
      const { password } = req.body;
      
      if (!password) {
        return res.status(400).json({ message: "Password is required" });
      }
      
      const success = await auth.verifyPasswordReset(token, password);
      if (!success) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }
      
      res.json({ message: "Password reset successfully" });
    } catch (error: any) {
      if (error.message.includes("Password must")) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  
  // ==================== Change Password ====================
  
  app.post(`${basePath}/password/change`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required" });
      }
      
      const success = await auth.changePassword(req.accountability.user.id, currentPassword, newPassword);
      if (!success) {
        return res.status(400).json({ message: "Failed to change password" });
      }
      
      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      if (error.message.includes("Password")) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  
  // ==================== Admin Change Password ====================
  
  app.post(`${basePath}/admin/password/change`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Check if user has admin role using shared isAdmin function
      if (!isAdmin(req)) {
        return res.status(403).json({ message: "Only administrators can change other users' passwords" });
      }
      
      const { userId, newPassword } = req.body;
      
      if (!userId || !newPassword) {
        return res.status(400).json({ message: "User ID and new password are required" });
      }
      
      // Verify target user exists
      const targetUser = await auth.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const success = await auth.resetPassword(userId, newPassword);
      if (!success) {
        return res.status(400).json({ message: "Failed to change password" });
      }
      
      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      if (error.message.includes("Password")) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  
  // ==================== Email Verification ====================
  
  app.post(`${basePath}/email/verify`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { link } = req.body;
      
      if (!(await isValidAppUrl(link))) {
        return res.status(400).json({ message: "Invalid link" });
      }
      
      const user = await auth.getUserById(req.accountability.user.id);
      if (!user || !user.email) {
        return res.status(400).json({ message: "User not found or no email set" });
      }
      
      if (user.emailVerified) {
        return res.json({ message: "Email already verified" });
      }
      
      // Create verification token
      const { token, expiresAt } = await auth.createEmailVerification(user.email);
      
      // Send email
      if (options.mailService) {
        const verifyUrl = `${link}/auth/verify-email/${token}`;
        
        await options.mailService.sendMail({
          to: user.email,
          subject: "Verify Your Email",
          templateName: "emailVerification",
          context: {
            verifyUrl,
            name: user.firstName || user.email,
          },
        });
      }
      
      res.json({ message: "Verification email sent" });
    } catch (error) {
      next(error);
    }
  });
  
  app.get(`${basePath}/email/verify/:token`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params;
      
      const user = await auth.verifyEmail(token);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }
      
      res.json({ message: "Email verified successfully", user });
    } catch (error) {
      next(error);
    }
  });
  
  // ==================== Session Check ====================
  
  app.get(`${basePath}/check`, async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;
      
      if (!token) {
        return res.status(401).json({
          valid: false,
          message: "No token provided",
        });
      }
      
      const result = await auth.validateSession(token);
      
      if (!result) {
        return res.status(401).json({
          valid: false,
          message: "Invalid or expired token",
        });
      }
      
      res.json({
        valid: true,
        user: { id: result.user.id },
      });
    } catch (error) {
      res.status(401).json({
        valid: false,
        message: "Invalid or expired token",
      });
    }
  });
  
  // ==================== Get Tenants ====================
  
  app.get(`${basePath}/tenants`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isMultiTenant = options.multiTenant?.enabled || options.env?.get("MULTI_TENANT") === "true";
      
      if (!isMultiTenant) {
        return res.status(400).json({ message: "Multi-tenant mode is not enabled" });
      }
      
      if (!req.accountability?.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Get all user roles with their tenants
      const userRoles = await auth.adapter.findUserRolesByUserId(req.accountability.user.id);
      
      // Filter to get only tenant-specific roles
      const tenants = [];
      for (const ur of userRoles) {
        if (ur.tenant_Id && ur.role?.isTenantSpecific) {
          const tenant = await auth.adapter.findTenantById(ur.tenant_Id);
          if (tenant) {
            tenants.push({
              id: tenant.id,
              name: tenant.name,
              role: {
                id: ur.role.id,
                name: ur.role.name,
              },
            });
          }
        }
      }
      
      res.json({ tenants });
    } catch (error) {
      next(error);
    }
  });
  
  // ==================== Switch Tenant ====================
  
  app.post(`${basePath}/switch-tenant`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isMultiTenant = options.multiTenant?.enabled || options.env?.get("MULTI_TENANT") === "true";
      
      if (!isMultiTenant) {
        return res.status(400).json({ message: "Multi-tenant mode is not enabled" });
      }
      
      if (!req.accountability?.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { tenant_Id, authType, authMode = "jwt" } = req.body;
      
      if (!tenant_Id) {
        return res.status(400).json({ message: "Tenant ID is required" });
      }
      
      // Get user role for the specified tenant
      const userRoles = await auth.adapter.findUserRolesByUserId(req.accountability.user.id, tenant_Id);
      
      if (!userRoles || userRoles.length === 0) {
        return res.status(403).json({ message: "Access denied for specified tenant" });
      }
      
      const userRole = userRoles[0];
      
      if (!userRole.role?.isTenantSpecific) {
        return res.status(400).json({ message: "Cannot switch tenant for non-tenant-specific role" });
      }
      
      // Get updated role and permissions
      const { role, permissions, tenant } = await auth.getUserRoleAndPermissions(
        req.accountability.user.id,
        tenant_Id
      );
      
      if (!tenant) {
        return res.status(404).json({ message: "Tenant not found" });
      }
      
      // Validate session limits if authType is specified
      if (authType && authType !== "default") {
        const { validateSessionLimits } = await import("../utils/auth.js");
        const validation = await validateSessionLimits(
          req.accountability.user.id,
          authType,
          tenant.id,
          role
        );
        
        if (!validation.isValid) {
          return res.status(403).json({ message: validation.error });
        }
      }
      
      // Create new session
      const ipAddress = req.ip || (req.connection as any)?.remoteAddress || null;
      const userAgent = req.headers["user-agent"] || null;

      const session = await auth.sessionService.createSession({
        user: req.accountability.user as any,
        tenantId: tenant.id,
        ipAddress,
        userAgent,
        type: authType || "default",
      });
      
      // Generate new token
      const token = auth.tokenService.generateUserToken({
        user: req.accountability.user as any,
        role,
        session,
        tenant,
      });
      
      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, token, authMode, options.env);
      
      res.json({
        ...tokenResponse,
        user: {
          id: req.accountability.user.id,
          email: req.accountability.user.email,
          firstName: (req.accountability.user as any).firstName,
          lastName: (req.accountability.user as any).lastName,
        },
        role,
        permissions,
        tenant,
      });
    } catch (error) {
      next(error);
    }
  });
  
  return auth;
}

/**
 * Create auth middleware for Express
 */
export function createAuthMiddleware(auth: BaasixAuth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract token
      let token = req.headers.authorization?.replace("Bearer ", "");
      
      if (!token && req.cookies?.token) {
        token = req.cookies.token;
      }
      
      if (!token && req.query?.access_token) {
        token = req.query.access_token as string;
      }
      
      if (!token && req.body?.access_token) {
        token = req.body.access_token;
      }
      
      if (!token) {
        // No token - treat as public access
        const publicRole = await getPublicRole();
        req.accountability = {
          user: null,
          role: publicRole as any,
          permissions: [],
          tenant: null,
          ipaddress: req.ip || (req.connection as any)?.remoteAddress,
        };
        
        return next();
      }
      
      // Validate session
      const result = await auth.validateSession(token);
      
      if (!result) {
        const publicRole = await getPublicRole();
        req.accountability = {
          user: null,
          role: publicRole as any,
          permissions: [],
          tenant: null,
          ipaddress: req.ip || (req.connection as any)?.remoteAddress,
        };
        
        return next();
      }
      
      const { user, role, permissions, tenant } = result;
      
      req.accountability = {
        user: {
          ...user,
          isAdmin: role.name === "administrator",
          role: role.name,
        } as any,
        role: role as any,
        permissions,
        tenant: tenant?.id || null,
        ipaddress: req.ip || (req.connection as any)?.remoteAddress,
      };
      
      next();
    } catch (error) {
      console.error("Auth middleware error:", error);
      
      // getPublicRole is now async (uses hybrid cache)
      const publicRole = await getPublicRole();
      req.accountability = {
        user: null,
        role: publicRole as any,
        permissions: [],
        tenant: null,
        ipaddress: req.ip || (req.connection as any)?.remoteAddress,
      };
      
      next();
    }
  };
}

export default { createAuthRoutes, createAuthMiddleware };
