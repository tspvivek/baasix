/**
 * Baasix Auth Core
 * Main entry point for the auth module
 * Inspired by better-auth architecture
 */

import argon2 from "argon2";
import type {
  AuthAdapter,
  AuthOptions,
  AuthContext,
  AuthResponse,
  OAuthProvider,
  User,
  Account,
  Role,
  Permission,
  Tenant,
  SignUpEmailInput,
  SignInEmailInput,
} from "./types.js";
import { createBaasixAdapter } from "./adapters/baasix-adapter.js";
import { createSessionService, validateSessionLimits } from "./services/session.js";
import { createTokenService } from "./services/token.js";
import { createVerificationService } from "./services/verification.js";
import { credential } from "./providers/credential.js";
import { google } from "./providers/google.js";
import { facebook } from "./providers/facebook.js";
import { apple } from "./providers/apple.js";
import { github } from "./providers/github.js";
import { generateState, generateCodeVerifier } from "./oauth2/utils.js";
import type { SessionService } from "./services/session.js";
import type { TokenService } from "./services/token.js";
import type { VerificationService } from "./services/verification.js";
import type { CredentialProvider } from "./providers/credential.js";

export interface BaasixAuth {
  // Core context
  context: AuthContext;
  adapter: AuthAdapter;
  
  // Services
  sessionService: SessionService;
  tokenService: TokenService;
  verificationService: VerificationService;
  credentialProvider: CredentialProvider;
  
  // OAuth Providers
  providers: Map<string, OAuthProvider>;
  
  // Email/Password Auth
  signUp(input: SignUpEmailInput): Promise<AuthResponse>;
  signIn(input: SignInEmailInput): Promise<AuthResponse>;
  
  // OAuth Auth
  getOAuthUrl(provider: string, redirectURI: string, scopes?: string[]): Promise<{
    url: string;
    state: string;
    codeVerifier: string;
  }>;
  handleOAuthCallback(provider: string, code: string, state: string, codeVerifier: string, redirectURI: string): Promise<AuthResponse>;
  
  // Session Management
  validateSession(token: string): Promise<{ user: User; role: Role; permissions: Permission[]; tenant: Tenant | null } | null>;
  invalidateSession(token: string): Promise<void>;
  invalidateAllSessions(userId: string): Promise<void>;
  
  // User Management
  getUserById(userId: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  updateUser(userId: string, data: Partial<User>): Promise<User | null>;
  
  // Role & Permission Management
  getUserRoleAndPermissions(userId: string, tenantId?: string | null): Promise<{
    role: Role;
    permissions: Permission[];
    tenant: Tenant | null;
  }>;
  
  // Password Management
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean>;
  resetPassword(userId: string, newPassword: string): Promise<boolean>;
  
  // Email Verification
  createEmailVerification(email: string): Promise<{ token: string; expiresAt: Date }>;
  verifyEmail(token: string): Promise<User | null>;
  
  // Magic Link
  createMagicLink(email: string): Promise<{ token: string; expiresAt: Date }>;
  verifyMagicLink(token: string): Promise<AuthResponse | null>;
  
  // Password Reset
  createPasswordReset(email: string): Promise<{ token: string; expiresAt: Date }>;
  verifyPasswordReset(token: string, newPassword: string): Promise<boolean>;
  
  // Token Generation (for extensions)
  generateTokenForUser(userId: string, options?: {
    tenantId?: string | null;
    sessionType?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<AuthResponse>;
}

/**
 * Default password hashing functions using argon2
 */
const defaultPasswordFunctions = {
  hash: async (password: string) => argon2.hash(password),
  verify: async ({ password, hash }: { password: string; hash: string }) => 
    argon2.verify(hash, password),
};

/**
 * Create a Baasix Auth instance
 */
export function createAuth(options: AuthOptions): BaasixAuth {
  // Create adapter
  const adapter = createBaasixAdapter();
  
  // Create services
  const sessionService = createSessionService(adapter, {
    expiresIn: options.session?.expiresIn,
    updateAge: options.session?.updateAge,
    cookieRefresh: options.session?.cookieRefresh,
  });
  
  const tokenService = createTokenService({
    secret: options.secret,
    expiresIn: options.session?.expiresIn ? `${options.session.expiresIn}s` : "7d",
  });
  
  const verificationService = createVerificationService(adapter);
  
  // Create credential provider
  const passwordFns = options.password || defaultPasswordFunctions;
  const credentialProvider = credential({
    hashPassword: passwordFns.hash,
    verifyPassword: passwordFns.verify,
    minPasswordLength: options.emailAndPassword?.minPasswordLength,
    maxPasswordLength: options.emailAndPassword?.maxPasswordLength,
  });
  
  // Initialize OAuth providers
  const providers = new Map<string, OAuthProvider>();
  
  if (options.socialProviders) {
    for (const [name, config] of Object.entries(options.socialProviders)) {
      if (!config.clientId || !config.clientSecret) continue;
      
      switch (name.toLowerCase()) {
        case "google":
          providers.set("google", google(config as any));
          break;
        case "facebook":
          providers.set("facebook", facebook(config as any));
          break;
        case "apple":
          providers.set("apple", apple(config as any));
          break;
        case "github":
          providers.set("github", github(config as any));
          break;
      }
    }
  }
  
  // Create context
  const context: AuthContext = {
    options,
    adapter,
    providers,
    session: null,
  };
  
  // Helper to get role and permissions
  async function getUserRoleAndPermissions(userId: string, tenantId?: string | null) {
    const userRoles = await adapter.findUserRolesByUserId(userId, tenantId);
    
    if (!userRoles || userRoles.length === 0) {
      throw new Error("User role not found");
    }
    
    const userRole = userRoles[0];
    const role = userRole.role;
    
    if (!role) {
      throw new Error("Role not found");
    }
    
    const permissions = await adapter.findPermissionsByRoleId(role.id);
    
    let tenant: Tenant | null = null;
    if (userRole.tenant_Id) {
      tenant = await adapter.findTenantById(userRole.tenant_Id);
    }
    
    return { role, permissions, tenant };
  }
  
  // Helper to create auth response
  async function createAuthResponse(
    user: User,
    tenantId?: string | null,
    ipAddress?: string | null,
    userAgent?: string | null,
    sessionType: string = "default"
  ): Promise<AuthResponse> {
    const { role, permissions, tenant } = await getUserRoleAndPermissions(user.id, tenantId);

    // Create session
    const session = await sessionService.createSession({
      user,
      tenantId: tenant?.id || null,
      ipAddress,
      userAgent,
      type: sessionType,
    });
    
    // Generate token
    const token = tokenService.generateUserToken({
      user,
      role,
      session,
      tenant,
    });
    
    return {
      token,
      user,
      role,
      permissions,
      tenant,
    };
  }
  
  return {
    context,
    adapter,
    sessionService,
    tokenService,
    verificationService,
    credentialProvider,
    providers,
    
    // Email/Password Sign Up
    async signUp(input) {
      const { email, password, firstName, lastName, phone, tenant, roleName, inviteToken, ipAddress, userAgent } = input;
      
      // Validate email and password are enabled
      if (options.emailAndPassword?.enabled === false) {
        throw new Error("Email and password authentication is disabled");
      }
      
      // Check if user already exists
      const existingUser = await adapter.findUserByEmail(email);
      if (existingUser) {
        throw new Error("User already exists");
      }
      
      let tenantId: string | null = null;
      let roleToAssign: Role | null = null;
      let inviteData: any = null;
      
      // Handle invite token if provided
      if (inviteToken) {
        inviteData = await adapter.findInviteByToken(inviteToken);
        
        if (!inviteData) {
          throw new Error("Invalid or expired invitation");
        }
        
        // Check if invited email matches registration email
        if (inviteData.email.toLowerCase() !== email.toLowerCase()) {
          throw new Error("The email address doesn't match the invitation");
        }
        
        // Use role and tenant from invite
        if (inviteData.role_Id) {
          roleToAssign = await adapter.findRoleById(inviteData.role_Id);
        }
        
        if (inviteData.tenant_Id) {
          tenantId = inviteData.tenant_Id;
        }
      } else {
        // Multi-tenant mode validation - only if no invite
        const isMultiTenant = options.multiTenant?.enabled;
        if (isMultiTenant && !tenant?.name) {
          throw new Error("Tenant information is required for registration in multi-tenant mode");
        }
        
        // Create tenant if provided
        if (tenant?.name) {
          const newTenant = await adapter.createTenant({ name: tenant.name });
          tenantId = newTenant.id;
        }
      }
      
      // Create user and credential account
      const { user, account } = await credentialProvider.signUp({
        adapter,
        email,
        password,
        firstName,
        lastName,
        phone,
      });
      
      // Get role to assign if not from invite
      if (!roleToAssign) {
        if (roleName) {
          roleToAssign = await adapter.findRoleByName(roleName);
        }
        
        if (!roleToAssign) {
          // Get default role
          const defaultRoleName = process.env.DEFAULT_ROLE_REGISTERED || "user";
          roleToAssign = await adapter.findRoleByName(defaultRoleName);
        }
      }
      
      if (!roleToAssign) {
        throw new Error("Default role not found");
      }
      
      // Create user role
      await adapter.createUserRole({
        user_Id: user.id,
        role_Id: roleToAssign.id,
        tenant_Id: tenantId,
      });
      
      // Mark invite as accepted if used
      if (inviteData) {
        await adapter.updateInviteStatus(inviteData.id, "accepted");
      }
      
      // Call hook if defined
      if (options.hooks?.onUserCreated) {
        await options.hooks.onUserCreated(user, account);
      }
      
      if (options.hooks?.onSignUp) {
        await options.hooks.onSignUp(user, account);
      }
      
      // Check if email verification is required
      const requireEmailVerification = options.emailAndPassword?.requireEmailVerification === true;
      
      if (requireEmailVerification) {
        // Don't create session or return token - user needs to verify email first
        const { role, permissions, tenant } = await getUserRoleAndPermissions(user.id, tenantId);
        return {
          token: "", // Empty token - user needs to verify email
          user,
          role,
          permissions,
          tenant,
          requiresEmailVerification: true,
        };
      }

      return createAuthResponse(user, tenantId, ipAddress, userAgent);
    },
    
    // Email/Password Sign In
    async signIn(input) {
      const { email, password, tenant_Id, authType = "default", ipAddress, userAgent } = input;
      
      // Validate email and password are enabled
      if (options.emailAndPassword?.enabled === false) {
        throw new Error("Email and password authentication is disabled");
      }
      
      // Authenticate user
      const user = await credentialProvider.signIn({
        adapter,
        email,
        password,
      });
      
      if (!user) {
        throw new Error("Invalid credentials");
      }
      
      // Check if email verification is required
      const requireEmailVerification = options.emailAndPassword?.requireEmailVerification === true;
      if (requireEmailVerification && !user.emailVerified) {
        throw new Error("Email not verified. Please verify your email before logging in.");
      }
      
      // Get role and permissions
      const { role, tenant } = await getUserRoleAndPermissions(user.id, tenant_Id);
      
      // Validate session type and limits
      const validation = await validateSessionLimits(
        sessionService,
        user.id,
        authType,
        tenant?.id || null,
        role
      );
      
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
      
      // Call hook if defined
      if (options.hooks?.onSignIn) {
        const session = await sessionService.createSession({
          user,
          tenantId: tenant?.id || null,
          type: authType,
        });
        await options.hooks.onSignIn(user, null, session);
        await sessionService.invalidateSession(session.token);
      }
      
      return createAuthResponse(user, tenant_Id, ipAddress, userAgent, authType);
    },
    
    // Get OAuth URL
    async getOAuthUrl(providerName, redirectURI, scopes) {
      const provider = providers.get(providerName);
      if (!provider) {
        throw new Error(`Provider '${providerName}' not found`);
      }
      
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      
      const url = await provider.createAuthorizationURL({
        state,
        codeVerifier,
        scopes,
        redirectURI,
      });
      
      return {
        url: url.toString(),
        state,
        codeVerifier,
      };
    },
    
    // Handle OAuth Callback
    async handleOAuthCallback(providerName, code, state, codeVerifier, redirectURI) {
      const provider = providers.get(providerName);
      if (!provider) {
        throw new Error(`Provider '${providerName}' not found`);
      }
      
      // Exchange code for tokens
      const tokens = await provider.validateAuthorizationCode({
        code,
        redirectURI,
        codeVerifier,
      });
      
      // Get user info from provider
      const userInfo = await provider.getUserInfo(tokens);
      if (!userInfo) {
        throw new Error("Failed to get user info from provider");
      }
      
      const { user: oauthUser, data: _profile } = userInfo;
      
      // Find or create user
      let user: User | null = null;
      let account: Account | null = null;
      
      // Check if account exists for this provider
      account = await adapter.findAccountByProvider(providerName, oauthUser.id.toString());
      
      if (account) {
        // Existing account - get user
        user = await adapter.findUserById(account.user_Id);
        
        // Update tokens
        await adapter.updateAccount(account.id, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          idToken: tokens.idToken,
          scope: tokens.scopes?.join(" "),
        });
      } else if (oauthUser.email) {
        // Check if user exists with this email
        user = await adapter.findUserByEmail(oauthUser.email);
        
        if (user) {
          // Link account to existing user
          account = await adapter.createAccount({
            user_Id: user.id,
            accountId: oauthUser.id.toString(),
            providerId: providerName,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            idToken: tokens.idToken,
            scope: tokens.scopes?.join(" "),
          });
          
          // Call hook if defined
          if (options.hooks?.onOAuthAccountLinked) {
            await options.hooks.onOAuthAccountLinked(user, account);
          }
        }
      }
      
      if (!user) {
        // Create new user
        user = await adapter.createUser({
          email: oauthUser.email || null,
          emailVerified: oauthUser.emailVerified,
          firstName: oauthUser.firstName || oauthUser.name || "User",
          lastName: oauthUser.lastName || null,
          status: "active",
        });
        
        // Create account
        account = await adapter.createAccount({
          user_Id: user.id,
          accountId: oauthUser.id.toString(),
          providerId: providerName,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          idToken: tokens.idToken,
          scope: tokens.scopes?.join(" "),
        });
        
        // Assign default role
        const defaultRoleName = process.env.DEFAULT_ROLE_REGISTERED || "user";
        const role = await adapter.findRoleByName(defaultRoleName);
        
        if (role) {
          await adapter.createUserRole({
            user_Id: user.id,
            role_Id: role.id,
          });
        }
        
        // Call hooks
        if (options.hooks?.onUserCreated) {
          await options.hooks.onUserCreated(user, account);
        }
        
        if (options.hooks?.onSignUp) {
          await options.hooks.onSignUp(user, account);
        }
      }
      
      return createAuthResponse(user);
    },
    
    // Validate Session
    async validateSession(token) {
      const decoded = tokenService.verifyToken(token);
      if (!decoded) {
        return null;
      }
      
      // Validate session in database
      const sessionResult = await sessionService.validateSession(decoded.sessionToken);
      if (!sessionResult) {
        return null;
      }
      
      const { user } = sessionResult;
      const { role, permissions, tenant } = await getUserRoleAndPermissions(
        user.id,
        decoded.tenant_Id
      );
      
      return { user, role, permissions, tenant };
    },
    
    // Invalidate Session
    async invalidateSession(token) {
      const decoded = tokenService.decodeToken(token);
      if (decoded?.sessionToken) {
        await sessionService.invalidateSession(decoded.sessionToken);
        
        // Call hook if defined
        if (options.hooks?.onSignOut) {
          const sessionResult = await sessionService.validateSession(decoded.sessionToken);
          if (sessionResult) {
            await options.hooks.onSignOut(sessionResult.session);
          }
        }
      }
    },
    
    // Invalidate All Sessions
    async invalidateAllSessions(userId) {
      await sessionService.invalidateAllSessions(userId);
    },
    
    // Get User by ID
    async getUserById(userId) {
      return adapter.findUserById(userId);
    },
    
    // Get User by Email
    async getUserByEmail(email) {
      return adapter.findUserByEmail(email);
    },
    
    // Update User
    async updateUser(userId, data) {
      const user = await adapter.updateUser(userId, data);
      
      if (user && options.hooks?.onUserUpdated) {
        await options.hooks.onUserUpdated(user);
      }
      
      return user;
    },
    
    // Get User Role and Permissions
    getUserRoleAndPermissions,
    
    // Change Password
    async changePassword(userId, currentPassword, newPassword) {
      return credentialProvider.changePassword({
        adapter,
        userId,
        currentPassword,
        newPassword,
      });
    },
    
    // Reset Password
    async resetPassword(userId, newPassword) {
      return credentialProvider.resetPassword({
        adapter,
        userId,
        newPassword,
      });
    },
    
    // Create Email Verification
    async createEmailVerification(email) {
      return verificationService.createEmailVerification(email);
    },
    
    // Verify Email
    async verifyEmail(token) {
      const email = await verificationService.verifyEmail(token);
      if (!email) {
        return null;
      }
      
      const user = await adapter.findUserByEmail(email);
      if (!user) {
        return null;
      }
      
      await adapter.updateUser(user.id, { emailVerified: true });
      return adapter.findUserById(user.id);
    },
    
    // Create Magic Link
    async createMagicLink(email) {
      return verificationService.createMagicLink(email);
    },
    
    // Verify Magic Link
    async verifyMagicLink(token) {
      const email = await verificationService.verifyMagicLink(token);
      if (!email) {
        return null;
      }
      
      let user = await adapter.findUserByEmail(email);
      if (!user) {
        return null;
      }
      
      // Mark email as verified after successful magic link login
      if (!user.emailVerified) {
        await adapter.updateUser(user.id, { emailVerified: true });
        user = await adapter.findUserById(user.id) as User;
      }
      
      return createAuthResponse(user);
    },
    
    // Create Password Reset
    async createPasswordReset(email) {
      return verificationService.createPasswordReset(email);
    },
    
    // Verify Password Reset and set new password
    async verifyPasswordReset(token, newPassword) {
      const email = await verificationService.verifyPasswordReset(token);
      if (!email) {
        return false;
      }
      
      const user = await adapter.findUserByEmail(email);
      if (!user) {
        return false;
      }
      
      return credentialProvider.resetPassword({
        adapter,
        userId: user.id,
        newPassword,
      });
    },
    
    // Generate Token for User (for extensions)
    async generateTokenForUser(userId, options = {}) {
      const { tenantId = null, sessionType = "default", ipAddress = null, userAgent = null } = options;

      const user = await adapter.findUserById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      return createAuthResponse(user, tenantId, ipAddress, userAgent, sessionType);
    },
  };
}

export default createAuth;
