import { Express } from "express";
import env from "../utils/env.js";
import crypto from "crypto";
import argon2 from "argon2";
import mailService from "../services/MailService.js";
import ItemsService from "../services/ItemsService.js";
import { parseQueryParams } from "../utils/router.js";
import settingsService from "../services/SettingsService.js";
import { generateJWT, verifyJWT, getUserRolesPermissionsAndTenant, validateSessionLimits, generateToken } from "../utils/auth.js";
import { APIError } from "../utils/errorHandler.js";

const registerEndpoint = (app: Express) => {
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

  // Registration endpoint
  app.post("/auth/register", async (req, res, next) => {
    try {
      const { email, password, firstName, lastName, tenant, roleName, inviteToken } = req.body;
      console.log(`[auth.route] Register attempt for email: ${email}`, { firstName, lastName, inviteToken: !!inviteToken });

      const isMultiTenant = env.get("MULTI_TENANT") === "true";

      // Check if user already exists
      const userService = new ItemsService("baasix_User", {
        accountability: undefined,
      });

      const existingUsers = await userService.readByQuery({
        filter: { email: { eq: email } },
        limit: 1,
      });

      if (existingUsers.data && existingUsers.data.length > 0) {
        return res.status(400).json({ message: "User already exists" });
      }

      let tenantId = null;
      let createdTenant = null;
      let roleToAssign: any = null;
      let invite: any = null;

      // Check for invite if token is provided
      if (inviteToken) {
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
          limit: 1,
        });

        if (!invites.data || invites.data.length === 0) {
          return res.status(400).json({ message: "Invalid or expired invitation" });
        }

        invite = invites.data[0];

        // Check if invited email matches registration email
        if (invite.email.toLowerCase() !== email.toLowerCase()) {
          return res.status(400).json({
            message: "The email address doesn't match the invitation",
          });
        }

        roleToAssign = invite.role;

        if (invite.tenant_Id) {
          createdTenant = invite.tenant;
          tenantId = invite.tenant_Id;
        }
      } else {
        // Multi-tenant mode validation - only if no invite
        if (isMultiTenant && !tenant) {
          return res.status(400).json({
            message: "Tenant information is required for registration in multi-tenant mode",
          });
        }

        // Create tenant if provided
        if (tenant && tenant.name) {
          const tenantService = new ItemsService("baasix_Tenant", {
            accountability: undefined,
          });
          tenantId = await tenantService.createOne(tenant);

          // Read back the created tenant
          createdTenant = await tenantService.readOne(tenantId);
          console.log('[auth.route] Tenant created with ID:', tenantId);
        }
      }

      // Create user logic (bypass permission checks for registration)
      console.log('[auth.route] Calling createOne for new user...');
      const newUserId = await userService.createOne({
        email,
        password,
        firstName,
        lastName,
      });
      console.log('[auth.route] User created with ID:', newUserId);

      // Get the role to assign if not from invite
      if (!roleToAssign) {
        const roleService = new ItemsService("baasix_Role", {
          accountability: undefined,
        });

        if (roleName) {
          // Use specified role if provided
          const roles = await roleService.readByQuery({
            filter: { name: { eq: roleName } },
            limit: 1,
          });
          if (roles.data && roles.data.length > 0) {
            roleToAssign = roles.data[0];
          }
        }

        if (!roleToAssign) {
          // Get the default role (defaults to "user")
          const defaultRoleName = env.get("DEFAULT_ROLE_REGISTERED") || "user";
          console.log(`[auth.route] Looking up role: ${defaultRoleName}`);

          const roles = await roleService.readByQuery({
            filter: { name: { eq: defaultRoleName } },
            limit: 1,
          });

          if (!roles.data || roles.data.length === 0) {
            console.error(`[auth.route] Role "${defaultRoleName}" not found`);
            throw new APIError(`Role "${defaultRoleName}" not found`, 500);
          }

          roleToAssign = roles.data[0];
        }
      }

      console.log(`[auth.route] Found role:`, roleToAssign.id);

      // Create UserRole entry
      const userRoleService = new ItemsService("baasix_UserRole", {
        accountability: undefined,
      });
      await userRoleService.createOne({
        user_Id: newUserId,
        role_Id: roleToAssign.id,
        tenant_Id: tenantId,
      });
      console.log('[auth.route] UserRole created');

      // Mark invitation as accepted if it was used
      if (invite) {
        const inviteService = new ItemsService("baasix_Invite", {
          accountability: undefined,
        });
        await inviteService.updateOne(invite.id, {
          status: "accepted",
          acceptedBy_Id: newUserId,
          acceptedAt: new Date(),
        });
        console.log('[auth.route] Invitation marked as accepted');
      }

      // Get user roles, permissions and tenant (matching Sequelize implementation)
      const { role: userRole, permissions, tenant: userTenant } = await getUserRolesPermissionsAndTenant(newUserId, tenantId);

      // Generate token with tenant_Id for proper role resolution
      const token = generateJWT({ id: newUserId, email, role: roleToAssign.name, tenant_Id: tenantId }, "7d");

      res.json({
        message: "User registered successfully",
        token,
        user: { id: newUserId, email, firstName, lastName },
        role: userRole,
        permissions,
        tenant: createdTenant || userTenant,
      });
    } catch (error) {
      next(error);
    }
  });

  // Login endpoint
  app.post("/auth/login", async (req, res, next) => {
    try {
      const { email, password, tenant_Id, authType } = req.body;
      console.log(`[auth.route] Login attempt for email: ${email}`, { tenant_Id, authType });

      // Verify user credentials
      const userService = new ItemsService("baasix_User", {
        accountability: undefined,
      });

      console.log('[auth.route] Calling readByQuery...');
      const users = await userService.readByQuery({
        filter: { email: { eq: email } },
        limit: 1,
      });
      console.log(`[auth.route] readByQuery returned ${users.data?.length || 0} users`);

      if (!users.data || users.data.length === 0) {
        console.log('[auth.route] No user found with email:', email);
        return next(new APIError("Invalid credentials", 401));
      }

      const user = users.data[0];
      console.log(`[auth.route] User found:`, user.id);

      // Verify password hash
      if (!user.password) {
        console.log('[auth.route] User has no password set');
        return next(new APIError("Invalid credentials", 401));
      }

      const isPasswordValid = await argon2.verify(user.password, password);
      if (!isPasswordValid) {
        console.log('[auth.route] Password verification failed');
        return res.status(400).json({ message: "Incorrect password." });
      }
      console.log('[auth.route] Password verified successfully');

      // Get user role and permissions using the helper function
      const { role, permissions, tenant } = await getUserRolesPermissionsAndTenant(user.id, tenant_Id);
      console.log(`[auth.route] User role: ${role.name}`, { tenant });

      // Validate session limits if authType is provided
      const sessionType = authType || "default";
      if (sessionType !== "default") {
        const validation = await validateSessionLimits(user.id, sessionType, tenant?.id, role);
        if (!validation.isValid) {
          return res.status(403).json({ message: validation.error });
        }
      }

      // Generate token with session creation
      const token = await generateToken(user, role, tenant, req.ip, sessionType);
      console.log('[auth.route] JWT generated successfully with role:', role.name, 'tenant_Id:', tenant?.id || null, 'sessionType:', sessionType);

      // Update lastAccess in baasix_User model to current time
      try {
        const userService = new ItemsService("baasix_User");
        await userService.updateOne(user.id, { lastAccess: new Date() });
      } catch (error) {
        console.error("Error updating lastAccess:", error);
      }

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        role,
        permissions,
        tenant: tenant || null,
      });
    } catch (error) {
      console.error('[auth.route] Login error:', error);
      next(error);
    }
  });

  // Get current user
  app.get("/auth/me", async (req, res, next) => {
    try {
      if (!req.accountability?.user) {
        return next(new APIError("Unauthorized", 401));
      }

      const query = parseQueryParams(req.query);
      const userService = new ItemsService("baasix_User", {
        accountability: req.accountability as any,
      });

      const user = await userService.readOne(req.accountability.user.id, query);

      // Update lastAccess in baasix_User model to current time
      try {
        await userService.updateOne(req.accountability.user.id, { lastAccess: new Date() });
      } catch (error) {
        console.error("Error updating lastAccess:", error);
      }

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

  // Get user's available tenants
  app.get("/auth/tenants", async (req, res, next) => {
    try {
      const isMultiTenant = env.get("MULTI_TENANT") === "true";
      if (!isMultiTenant) {
        return res.status(400).json({ message: "Multi-tenant mode is not enabled" });
      }

      if (!req.accountability?.user) {
        return next(new APIError("Unauthorized", 401));
      }

      const userRoleService = new ItemsService("baasix_UserRole", {
        accountability: undefined,
      });

      // Get all user roles with their tenants and role info
      const userRoles = await userRoleService.readByQuery({
        filter: { user_Id: { eq: req.accountability.user.id } },
        fields: ["id", "tenant_Id", "role_Id", "tenant.*", "role.*"],
      });

      if (!userRoles.data) {
        return res.json({ tenants: [] });
      }

      // Filter to get only tenants with tenant-specific roles
      const tenants = userRoles.data
        .filter((ur: any) => ur.tenant && ur.role?.isTenantSpecific === true)
        .map((ur: any) => ({
          id: ur.tenant.id,
          name: ur.tenant.name,
          role: {
            id: ur.role.id,
            name: ur.role.name,
          },
        }));

      res.json({ tenants });
    } catch (error) {
      console.error("Error fetching tenants:", error);
      next(error);
    }
  });

  // Switch tenant
  app.post("/auth/switch-tenant", async (req, res, next) => {
    try {
      const isMultiTenant = env.get("MULTI_TENANT") === "true";
      if (!isMultiTenant) {
        return res.status(400).json({ message: "Multi-tenant mode is not enabled" });
      }

      if (!req.accountability?.user) {
        return next(new APIError("Unauthorized", 401));
      }

      const { tenant_Id, authType } = req.body;
      if (!tenant_Id) {
        return res.status(400).json({ message: "Tenant ID is required" });
      }

      const userRoleService = new ItemsService("baasix_UserRole", {
        accountability: undefined,
      });

      // Find user role with the requested tenant
      const userRoles = await userRoleService.readByQuery({
        filter: {
          user_Id: { eq: req.accountability.user.id },
          tenant_Id: { eq: tenant_Id },
        },
        fields: ["id", "tenant_Id", "role_Id", "tenant.*", "role.*"],
        limit: 1,
      });

      if (!userRoles.data || userRoles.data.length === 0) {
        return res.status(403).json({ message: "Access denied for specified tenant" });
      }

      const userRole = userRoles.data[0] as any;

      if (!userRole.tenant) {
        return res.status(403).json({ message: "Access denied for specified tenant" });
      }

      // Verify if the role is tenant-specific
      if (!userRole.role || !userRole.role.isTenantSpecific) {
        return res.status(400).json({
          message: "Cannot switch tenant for non-tenant-specific role",
        });
      }

      // Get updated role, permissions and tenant
      const { role, permissions, tenant } = await getUserRolesPermissionsAndTenant(
        req.accountability.user.id,
        tenant_Id
      );

      // Validate session limits for the target tenant if authType is provided
      const sessionType = authType || "default";
      if (sessionType !== "default") {
        const validation = await validateSessionLimits(req.accountability.user.id, sessionType, tenant_Id, role);
        if (!validation.isValid) {
          return res.status(403).json({ message: validation.error });
        }
      }

      // Generate new token with session creation
      const token = await generateToken(req.accountability.user, role, tenant, req.ip, sessionType);

      res.json({
        token,
        user: {
          id: req.accountability.user.id,
          email: req.accountability.user.email,
          firstName: (req.accountability.user as any).firstName,
          lastName: (req.accountability.user as any).lastName,
        },
        role,
        permissions,
        tenant: {
          id: tenant.id,
          name: tenant.name,
        },
      });
    } catch (error) {
      console.error("Error switching tenant:", error);
      next(error);
    }
  });

  // Create invitation
  app.post("/auth/invite", async (req, res, next) => {
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

      const { email, role_Id, tenant_Id = req.accountability?.tenant, link } = req.body;
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
      // Note: req.accountability.tenant might be just the ID or an object with id
      const userTenantId = typeof req.accountability?.tenant === 'object'
        ? (req.accountability.tenant as any)?.id
        : req.accountability?.tenant;

      console.log("[INVITE DEBUG] userTenantId:", userTenantId, "tenant_Id:", tenant_Id, "isAdmin:", (req.accountability.user as any).isAdmin);
      console.log("[INVITE DEBUG] req.accountability.tenant:", req.accountability?.tenant);
      console.log("[INVITE DEBUG] canInviteRoleIds:", canInviteRoleIds, "requested role_Id:", role_Id);

      if (userTenantId !== tenant_Id && !(req.accountability.user as any).isAdmin) {
        return res.status(403).json({
          message: "You don't have permission to invite users to this tenant",
        });
      }

      // Use ItemsService for invitation (bypass permissions for invite creation)
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

      // Create invitation record using ItemsService
      const inviteId = await inviteService.createOne({
        email,
        role_Id,
        tenant_Id,
        token,
        status: "pending",
        expiresAt,
        invitedBy_Id: req.accountability.user.id,
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

      // Send invitation email (skip in test mode if email fails)
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
        // In test mode, don't fail the invitation creation if email fails
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
  app.get("/auth/verify-invite/:token", async (req, res, next) => {
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
  app.post("/auth/accept-invite", async (req, res, next) => {
    try {
      if (!req.accountability?.user) {
        return next(new APIError("Unauthorized", 401));
      }

      const { inviteToken } = req.body;

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
      if (req.accountability.user.email.toLowerCase() !== invite.email.toLowerCase()) {
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
          user_Id: { eq: req.accountability.user.id },
          role_Id: { eq: invite.role_Id },
          tenant_Id: { eq: invite.tenant_Id },
        },
        limit: 1,
      });

      if (!existingRoles.data || existingRoles.data.length === 0) {
        // Create user-role association
        await userRoleService.createOne({
          user_Id: req.accountability.user.id,
          role_Id: invite.role_Id,
          tenant_Id: invite.tenant_Id,
        });
      }

      // Update invitation status
      await inviteService.updateOne(invite.id, {
        status: "accepted",
        acceptedBy_Id: req.accountability.user.id,
        acceptedAt: new Date(),
      });

      // Generate a new token for the user with the new tenant context
      const { role, permissions } = await getUserRolesPermissionsAndTenant(req.accountability.user.id, invite.tenant_Id);

      const token = await generateToken(
        req.accountability.user,
        role,
        invite.tenant,
        req.ip,
        "default"
      );

      return res.json({
        message: "Invitation accepted successfully",
        token,
        user: {
          id: req.accountability.user.id,
          email: req.accountability.user.email,
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

  // Logout
  app.get("/auth/logout", async (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out successfully" });
  });

  // Magic link request
  app.post("/auth/magiclink", async (req, res, next) => {
    try {
      const { email, link, mode = "link" } = req.body;

      if (mode === "link") {
        const allowedUrls = await getAllowedAppUrls();
        if (!link || !allowedUrls.includes(link)) {
          return next(new APIError("Invalid link", 400));
        }
      }

      const userService = new ItemsService("baasix_User", {
        accountability: undefined,
      });

      const users = await userService.readByQuery({
        filter: { email: { eq: email } },
        limit: 1,
      });

      if (!users.data || users.data.length === 0) {
        return next(new APIError("User not found", 404));
      }

      const user = users.data[0];
      const token = crypto.randomBytes(32).toString("hex");

      await userService.updateOne(user.id, {
        magicLinkToken: token,
        magicLinkExpires: new Date(Date.now() + 3600000), // 1 hour
      });

      if (mode === "link") {
        const magicLinkUrl = `${link}/auth/magiclink/${token}`;

        await mailService.sendMail({
          to: user.email,
          subject: "Sign in to Your App",
          templateName: "magicLinkUrl",
          context: {
            magicLinkUrl,
            name: user.firstName || user.email,
          },
        });
      } else if (mode === "code") {
        await mailService.sendMail({
          to: user.email,
          subject: "Sign in to Your App",
          templateName: "magicLinkCode",
          context: {
            code: token.substring(0, 12),
            name: user.firstName || user.email,
          },
        });
      }

      res.json({ message: "Instruction sent to your email" });
    } catch (error) {
      next(error);
    }
  });

  // Magic link verify
  app.get("/auth/magiclink/:token", async (req, res, next) => {
    try {
      const { token } = req.params;

      const userService = new ItemsService("baasix_User", {
        accountability: undefined,
      });

      const users = await userService.readByQuery({
        filter: {
          magicLinkToken: { eq: token },
          magicLinkExpires: { gt: new Date().toISOString() },
        },
        limit: 1,
      });

      if (!users.data || users.data.length === 0) {
        return next(new APIError("Invalid or expired token", 400));
      }

      const user = users.data[0];

      // Clear magic link token
      await userService.updateOne(user.id, {
        magicLinkToken: null,
        magicLinkExpires: null,
      });

      // Generate JWT
      const jwtToken = generateJWT({ id: user.id, email: user.email, role: user.role || "user" }, "7d");

      res.json({
        token: jwtToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Check session validity
  app.get("/auth/check", async (req, res) => {
    try {
      const token = req.headers.authorization?.split(" ")[1] || req.cookies?.token;

      if (!token) {
        return res.status(401).json({
          valid: false,
          message: "No token provided",
        });
      }

      const decoded = verifyJWT(token);

      if (!decoded) {
        return res.status(401).json({
          valid: false,
          message: "Invalid token",
        });
      }

      res.json({
        valid: true,
        user: { id: decoded.userId },
      });
    } catch (error) {
      res.status(401).json({
        valid: false,
        message: "Invalid or expired token",
      });
    }
  });
};

export default {
  id: "auth",
  handler: registerEndpoint,
};
