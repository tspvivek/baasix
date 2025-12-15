/**
 * Auth Route
 * Uses the new auth module with adapter-based architecture
 * Includes invitation system for multi-tenant support
 */

import type { Express, Request, Response, NextFunction } from "express";
import { createAuthRoutes, setTokenInResponse } from "../auth/index.js";
import type { BaasixAuth, AuthRouteOptions } from "../auth/index.js";
import env from "../utils/env.js";
import crypto from "crypto";
import mailService from "../services/MailService.js";
import settingsService from "../services/SettingsService.js";
import ItemsService from "../services/ItemsService.js";
import { APIError } from "../utils/errorHandler.js";

// Store the auth instance for use in other parts of the app
let authInstance: BaasixAuth | null = null;

const registerEndpoint = (app: Express) => {
  // Parse enabled auth services
  const enabledServices = (env.get("AUTH_SERVICES_ENABLED") || "LOCAL").split(",").map(s => s.trim().toUpperCase());
  
  // Initialize the new auth module
  const authOptions: AuthRouteOptions = {
    secret: env.get("SECRET_KEY") || env.get("JWT_SECRET") || "",
    baseURL: env.get("BASE_URL"),
    session: {
      expiresIn: parseInt(env.get("ACCESS_TOKEN_EXPIRES_IN") || "604800"), // 7 days default
    },
    emailAndPassword: {
      enabled: enabledServices.includes("LOCAL"), // LOCAL = email/password authentication
      requireEmailVerification: env.get("REQUIRE_EMAIL_VERIFICATION") === "true", // Default false
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    multiTenant: {
      enabled: env.get("MULTI_TENANT") === "true",
    },
    // Social providers from env - only enable if listed in AUTH_SERVICES_ENABLED
    socialProviders: (() => {
      const providers: Record<string, any> = {};
      
      // Google
      if (enabledServices.includes("GOOGLE") && env.get("GOOGLE_CLIENT_ID")) {
        providers.google = {
          clientId: env.get("GOOGLE_CLIENT_ID")!,
          clientSecret: env.get("GOOGLE_CLIENT_SECRET")!,
          scope: ["email", "profile"],
        };
      }
      
      // Facebook
      if (enabledServices.includes("FACEBOOK") && env.get("FACEBOOK_CLIENT_ID")) {
        providers.facebook = {
          clientId: env.get("FACEBOOK_CLIENT_ID")!,
          clientSecret: env.get("FACEBOOK_CLIENT_SECRET")!,
        };
      }
      
      // Apple
      if (enabledServices.includes("APPLE") && env.get("APPLE_CLIENT_ID")) {
        providers.apple = {
          clientId: env.get("APPLE_CLIENT_ID")!,
          clientSecret: env.get("APPLE_CLIENT_SECRET") || "",
          teamId: env.get("APPLE_TEAM_ID")!,
          keyId: env.get("APPLE_KEY_ID")!,
          privateKey: env.get("APPLE_PRIVATE_KEY")!,
        };
      }
      
      // GitHub
      if (enabledServices.includes("GITHUB") && env.get("GITHUB_CLIENT_ID")) {
        providers.github = {
          clientId: env.get("GITHUB_CLIENT_ID")!,
          clientSecret: env.get("GITHUB_CLIENT_SECRET")!,
        };
      }
      
      return providers;
    })(),
    mailService: {
      sendMail: async (options) => {
        await mailService.sendMail(options);
      },
    },
    settingsService: {
      getAllSettingsUrls: () => settingsService.getAllSettingsUrls(),
      getTenantSettings: (tenantId: string) => settingsService.getTenantSettings(tenantId),
      getGlobalSettings: () => settingsService.getGlobalSettings(),
    },
    env: {
      get: (key: string) => env.get(key),
    },
  };

  // Create auth routes

  // Create auth instance and register routes
  authInstance = createAuthRoutes(app, authOptions);

  // ====================
  // Invitation System Routes
  // These are application-specific and kept in the route file
  // ====================

  // Helper to get allowed app URLs
  const getAllowedAppUrls = async () => {
    try {
      const staticUrls = env.get("AUTH_APP_URL")?.split(",").map((url: string) => url.trim()) || [];
      const dynamicUrls = await settingsService.getAllSettingsUrls();
      const allUrls = [...new Set([...staticUrls, ...dynamicUrls])];
      return allUrls;
    } catch (error) {
      console.error("Error getting allowed app URLs:", error);
      return env.get("AUTH_APP_URL")?.split(",").map((url: string) => url.trim()) || [];
    }
  };

  // Create invitation
  app.post("/auth/invite", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("[INVITE] Endpoint called");
      console.log("[INVITE] req.accountability:", JSON.stringify(req.accountability, null, 2));
      console.log("[INVITE] req.body:", JSON.stringify(req.body, null, 2));

      const isMultiTenant = env.get("MULTI_TENANT") === "true";
      if (!isMultiTenant) {
        return res.status(400).json({ message: "Multi-tenant mode is not enabled" });
      }

      if (!req.accountability?.user) {
        console.log("[INVITE] No user in accountability - returning 401");
        return next(new APIError("Unauthorized", 401));
      }

      const { email, role_Id, tenant_Id = (req.accountability?.tenant as any)?.id || req.accountability?.tenant, link } = req.body;
      console.log("[INVITE] Parsed values - email:", email, "role_Id:", role_Id, "tenant_Id:", tenant_Id);

      if (!email || !role_Id) {
        return res.status(400).json({ message: "Email and role are required" });
      }

      if (!tenant_Id) {
        return res.status(400).json({ message: "Tenant ID is required" });
      }

      // Check if link is valid
      const allowedAppUrls = await getAllowedAppUrls();
      if (!link || !allowedAppUrls.includes(link)) {
        return res.status(400).json({ message: "Invalid application URL" });
      }

      // Check if inviter has permission to invite for this role
      const currentUserRoleId = (req.accountability?.role as any)?.id;
      if (!currentUserRoleId) {
        return res.status(403).json({ message: "You don't have permission to invite users" });
      }

      // Get the inviter's role
      const roleService = new ItemsService("baasix_Role", {
        accountability: undefined,
      });
      const inviterRole = await roleService.readOne(currentUserRoleId);

      if (!inviterRole) {
        return res.status(403).json({ message: "Invalid role configuration" });
      }

      // Check if current user can invite for the specified role
      const canInviteRoleIds = (inviterRole as any).canInviteRoleIds || [];

      // Admin can invite any role, otherwise check if role is in canInviteRoleIds
      if (!(req.accountability.user as any).isAdmin && !canInviteRoleIds.includes(role_Id)) {
        return res.status(403).json({
          message: "You don't have permission to invite users with this role",
        });
      }

      // Check if current user can invite for this tenant
      const userTenantId = typeof req.accountability?.tenant === 'object'
        ? (req.accountability.tenant as any)?.id
        : req.accountability?.tenant;

      if (userTenantId !== tenant_Id && !(req.accountability.user as any).isAdmin) {
        return res.status(403).json({
          message: "You don't have permission to invite users to this tenant",
        });
      }

      // Use ItemsService for invitation
      const inviteService = new ItemsService("baasix_Invite", {
        accountability: undefined,
      });

      // Check if an active invite already exists
      const existingInvites = await inviteService.readByQuery({
        filter: {
          email: { eq: email },
          tenant_Id: { eq: tenant_Id },
          status: { eq: "pending" },
        },
      });

      if (existingInvites?.data?.length > 0) {
        return res.status(400).json({
          message: "An invitation has already been sent to this email for this tenant",
        });
      }

      // Generate invite token and expiration
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Create invitation record
      const inviteId = await inviteService.createOne({
        email,
        role_Id,
        tenant_Id,
        token,
        status: "pending",
        expiresAt,
        invitedBy_Id: (req.accountability.user as any).id,
      });

      // Check if user already exists
      const userService = new ItemsService("baasix_User", {
        accountability: undefined,
      });
      const existingUsers = await userService.readByQuery({
        filter: { email: { eq: email } },
        limit: 1,
      });
      const existingUser = existingUsers.data && existingUsers.data.length > 0 ? existingUsers.data[0] : null;

      // Get tenant details for the email
      const tenantService = new ItemsService("baasix_Tenant", {
        accountability: undefined,
      });
      const tenant = await tenantService.readOne(tenant_Id);

      // Personalize email based on whether user exists or not
      const emailTemplate = existingUser ? "inviteExistingUser" : "inviteNewUser";

      // Use the provided link to build invitation URLs
      let inviteLink = `${link}/accept-invite?token=${token}`;
      if (existingUser) {
        inviteLink = `${link}/accept-invite?token=${token}&existing=true`;
      }

      // Send invitation email
      try {
        await mailService.sendMail({
          to: email,
          subject: "You've been invited to join",
          templateName: emailTemplate,
          context: {
            inviteLink,
            tenant: (tenant as any).name,
            expirationDate: expiresAt.toLocaleDateString(),
            inviterName: `${(req.accountability.user as any).firstName} ${(req.accountability.user as any).lastName}`.trim(),
            existingUser: !!existingUser,
          },
        });
      } catch (emailError) {
        console.error("Error sending invitation email:", emailError);
        if (env.get("NODE_ENV") === "test") {
          console.log("Test mode: Skipping email failure - invitation created successfully");
        } else {
          throw emailError;
        }
      }

      return res.json({
        message: "Invitation sent successfully",
        invite: {
          id: inviteId,
          email,
          status: "pending",
          expiresAt,
        },
      });
    } catch (error) {
      console.error("Error sending invitation:", error);
      next(error);
    }
  });

  // Verify invitation
  app.get("/auth/verify-invite/:token", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params;
      const { link } = req.query;

      // Validate link if provided
      if (link) {
        const allowedAppUrls = await getAllowedAppUrls();
        if (!allowedAppUrls.includes(link as string)) {
          return res.status(400).json({ message: "Invalid application URL" });
        }
      }

      // Use ItemsService to find the invitation
      const inviteService = new ItemsService("baasix_Invite", {
        accountability: undefined,
      });

      const invites = await inviteService.readByQuery({
        filter: {
          token: { eq: token },
          status: { eq: "pending" },
          expiresAt: { gt: new Date().toISOString() },
        },
        fields: ["id", "email", "role_Id", "tenant_Id", "role.id", "role.name", "tenant.id", "tenant.name"],
      });

      if (!invites.data || invites.data.length === 0) {
        return res.status(400).json({ message: "Invalid or expired invitation" });
      }

      const invite = invites.data[0] as any;

      // Check if the user already exists
      const userService = new ItemsService("baasix_User", {
        accountability: undefined,
      });
      const existingUsers = await userService.readByQuery({
        filter: { email: { eq: invite.email.toLowerCase() } },
        limit: 1,
      });
      const existingUser = existingUsers.data && existingUsers.data.length > 0 ? existingUsers.data[0] : null;

      // Include redirect URLs in response if link was provided
      let redirectUrls = {};
      if (link) {
        redirectUrls = {
          acceptUrl: existingUser
            ? `${link}/login?inviteToken=${token}`
            : `${link}/register?inviteToken=${token}&email=${encodeURIComponent(invite.email)}`,
        };
      }

      return res.json({
        valid: true,
        email: invite.email,
        userExists: !!existingUser,
        tenant: {
          id: invite.tenant?.id,
          name: invite.tenant?.name,
        },
        role: {
          id: invite.role?.id,
          name: invite.role?.name,
        },
        ...redirectUrls,
      });
    } catch (error) {
      console.error("Error verifying invitation:", error);
      next(error);
    }
  });

  // Accept invitation (for existing users)
  app.post("/auth/accept-invite", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.accountability?.user) {
        return next(new APIError("Unauthorized", 401));
      }

      const { inviteToken, authMode = "jwt" } = req.body;

      if (!inviteToken) {
        return res.status(400).json({ message: "Invitation token is required" });
      }

      // Use ItemsService to find the invitation
      const inviteService = new ItemsService("baasix_Invite", {
        accountability: undefined,
      });

      const invites = await inviteService.readByQuery({
        filter: {
          token: { eq: inviteToken },
          status: { eq: "pending" },
          expiresAt: { gt: new Date().toISOString() },
        },
        fields: ["id", "email", "role_Id", "tenant_Id", "role.id", "role.name", "tenant.id", "tenant.name"],
      });

      if (!invites.data || invites.data.length === 0) {
        return res.status(400).json({ message: "Invalid or expired invitation" });
      }

      const invite = invites.data[0] as any;

      // Verify that the current user is the invited user
      if ((req.accountability.user as any).email.toLowerCase() !== invite.email.toLowerCase()) {
        return res.status(403).json({
          message: "This invitation is for a different email address",
        });
      }

      // Check if user already has this role in this tenant
      const userRoleService = new ItemsService("baasix_UserRole", {
        accountability: undefined,
      });
      const existingRoles = await userRoleService.readByQuery({
        filter: {
          user_Id: { eq: (req.accountability.user as any).id },
          role_Id: { eq: invite.role_Id },
          tenant_Id: { eq: invite.tenant_Id },
        },
        limit: 1,
      });

      if (!existingRoles.data || existingRoles.data.length === 0) {
        // Create user-role association
        await userRoleService.createOne({
          user_Id: (req.accountability.user as any).id,
          role_Id: invite.role_Id,
          tenant_Id: invite.tenant_Id,
        });
      }

      // Update invitation status
      await inviteService.updateOne(invite.id, {
        status: "accepted",
        acceptedBy_Id: (req.accountability.user as any).id,
        acceptedAt: new Date(),
      });

      // Generate a new token for the user with the new tenant context
      if (!authInstance) {
        return res.status(500).json({ message: "Auth module not initialized" });
      }

      const { role, permissions, tenant: _tenant } = await authInstance.getUserRoleAndPermissions(
        (req.accountability.user as any).id,
        invite.tenant_Id
      );

      const session = await authInstance.sessionService.createSession({
        user: req.accountability.user as any,
        tenantId: invite.tenant_Id,
      });

      const token = authInstance.tokenService.generateUserToken({
        user: req.accountability.user as any,
        role,
        session,
        tenant: invite.tenant,
      });

      // Set token in response based on authMode
      const tokenResponse = setTokenInResponse(res, token, authMode, env);

      return res.json({
        message: "Invitation accepted successfully",
        ...tokenResponse,
        user: {
          id: (req.accountability.user as any).id,
          email: (req.accountability.user as any).email,
          firstName: (req.accountability.user as any).firstName,
          lastName: (req.accountability.user as any).lastName,
        },
        role,
        permissions,
        tenant: invite.tenant,
      });
    } catch (error) {
      console.error("Error accepting invitation:", error);
      next(error);
    }
  });
};

// Export the auth instance getter for middleware and other parts of the app
export function getAuthInstance(): BaasixAuth | null {
  return authInstance;
}

export default {
  id: "auth",
  handler: registerEndpoint,
};
