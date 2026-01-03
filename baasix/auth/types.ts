/**
 * Core types for the Baasix Auth module
 * Inspired by better-auth architecture
 */

// ==================== User Types ====================

export interface User {
  id: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  avatar_Id?: string | null;
  status: "active" | "inactive" | "deleted" | "suspended" | "pending";
  lastAccess?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithPassword extends User {
  password?: string | null;
}

// ==================== Account Types ====================

export interface Account {
  id: string;
  user_Id: string;
  accountId: string;
  providerId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
  scope?: string | null;
  idToken?: string | null;
  password?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== Session Types ====================

export interface Session {
  id: string;
  token: string;
  user_Id: string;
  tenant_Id?: string | null;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionWithUser {
  session: Session;
  user: User;
}

// ==================== Verification Types ====================

export interface Verification {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== Role & Permission Types ====================

export interface Role {
  id: string;
  name: string;
  description?: string | null;
  isTenantSpecific: boolean;
  canInviteRoleIds?: string[] | null;
}

export interface Permission {
  id: string;
  action: string;
  collection: string;
  role_Id: string;
  fields?: Record<string, any> | null;
  defaultValues?: Record<string, any> | null;
  conditions?: Record<string, any> | null;
  relConditions?: Record<string, any> | null;
}

export interface UserRole {
  id: string;
  user_Id: string;
  role_Id: string;
  tenant_Id?: string | null;
}

export interface Tenant {
  id: string;
  name: string;
}

// ==================== OAuth Types ====================

export interface OAuth2Tokens {
  tokenType?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scopes?: string[];
  idToken?: string;
  raw?: Record<string, unknown>;
}

export interface OAuth2UserInfo {
  id: string | number;
  name?: string;
  email?: string | null;
  image?: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}

// ==================== Provider Types ====================

export interface ProviderOptions<Profile extends Record<string, any> = any> {
  clientId: string;
  clientSecret: string;
  scope?: string[];
  disableDefaultScope?: boolean;
  redirectURI?: string;
  prompt?: string;
  mapProfileToUser?: (profile: Profile) => Partial<User> | Promise<Partial<User>>;
  disableImplicitSignUp?: boolean;
  disableSignUp?: boolean;
}

export interface OAuthProvider<
  Profile extends Record<string, any> = Record<string, any>,
  Options extends ProviderOptions<Profile> = ProviderOptions<Profile>
> {
  id: string;
  name: string;
  createAuthorizationURL: (data: {
    state: string;
    codeVerifier: string;
    scopes?: string[];
    redirectURI: string;
    loginHint?: string;
  }) => Promise<URL> | URL;
  validateAuthorizationCode: (data: {
    code: string;
    redirectURI: string;
    codeVerifier?: string;
  }) => Promise<OAuth2Tokens>;
  getUserInfo: (token: OAuth2Tokens) => Promise<{
    user: OAuth2UserInfo;
    data: Profile;
  } | null>;
  refreshAccessToken?: (refreshToken: string) => Promise<OAuth2Tokens>;
  verifyIdToken?: (token: string, nonce?: string) => Promise<boolean>;
  options?: Options;
}

// ==================== Auth Context Types ====================

export interface AuthOptions {
  /**
   * Secret key for JWT signing
   */
  secret: string;
  /**
   * Base URL of the application
   */
  baseURL?: string;
  /**
   * Trusted origins for CORS
   */
  trustedOrigins?: string[] | ((request: Request) => Promise<string[]>);
  /**
   * Session configuration
   */
  session?: {
    expiresIn?: number; // in seconds, default 7 days
    updateAge?: number; // when to update session, default 1 day
    cookieRefresh?: boolean;
  };
  /**
   * Email and password auth configuration
   */
  emailAndPassword?: {
    enabled?: boolean;
    requireEmailVerification?: boolean;
    minPasswordLength?: number;
    maxPasswordLength?: number;
  };
  /**
   * Social providers configuration
   */
  socialProviders?: {
    [key: string]: ProviderOptions;
  };
  /**
   * Multi-tenant configuration
   */
  multiTenant?: {
    enabled?: boolean;
    tenantField?: string;
  };
  /**
   * Rate limiting configuration
   */
  rateLimit?: {
    enabled?: boolean;
    window?: number;
    max?: number;
  };
  /**
   * Password hashing functions
   */
  password?: {
    hash: (password: string) => Promise<string>;
    verify: (data: { password: string; hash: string }) => Promise<boolean>;
  };
  /**
   * Hooks for auth events
   */
  hooks?: AuthHooks;
}

export interface AuthHooks {
  onUserCreated?: (user: User, account: Account | null) => Promise<void>;
  onUserUpdated?: (user: User) => Promise<void>;
  onUserDeleted?: (userId: string) => Promise<void>;
  onSessionCreated?: (session: Session, user: User) => Promise<void>;
  onSessionDeleted?: (session: Session) => Promise<void>;
  onSignIn?: (user: User, account: Account | null, session: Session) => Promise<void>;
  onSignUp?: (user: User, account: Account | null) => Promise<void>;
  onSignOut?: (session: Session) => Promise<void>;
  onOAuthAccountLinked?: (user: User, account: Account) => Promise<void>;
}

// ==================== Adapter Types ====================

export interface Where {
  field: string;
  operator: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "contains" | "starts_with" | "ends_with";
  value: string | number | boolean | string[] | number[] | Date | null;
  connector?: "AND" | "OR";
}

export interface AuthAdapter {
  // User operations
  createUser(user: Omit<User, "id" | "createdAt" | "updatedAt">): Promise<User>;
  findUserById(userId: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  updateUser(userId: string, data: Partial<User>): Promise<User | null>;
  deleteUser(userId: string): Promise<void>;
  
  // Account operations
  createAccount(account: Omit<Account, "id" | "createdAt" | "updatedAt">): Promise<Account>;
  findAccountByProvider(providerId: string, accountId: string): Promise<Account | null>;
  findAccountsByUserId(userId: string): Promise<Account[]>;
  updateAccount(accountId: string, data: Partial<Account>): Promise<Account | null>;
  deleteAccount(accountId: string): Promise<void>;
  deleteAccountsByUserId(userId: string): Promise<void>;
  
  // Session operations
  createSession(session: Omit<Session, "id" | "createdAt" | "updatedAt">): Promise<Session>;
  findSessionByToken(token: string): Promise<SessionWithUser | null>;
  findSessionsByUserId(userId: string): Promise<Session[]>;
  updateSession(sessionId: string, data: Partial<Session>): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSessionByToken(token: string): Promise<void>;
  deleteSessionsByUserId(userId: string): Promise<void>;
  
  // Verification operations
  createVerification(verification: Omit<Verification, "id" | "createdAt" | "updatedAt">): Promise<Verification>;
  findVerificationByIdentifier(identifier: string): Promise<Verification | null>;
  deleteVerification(verificationId: string): Promise<void>;
  deleteVerificationByIdentifier(identifier: string): Promise<void>;
  
  // Role operations
  findRoleByName(name: string): Promise<Role | null>;
  findRoleById(roleId: string): Promise<Role | null>;
  
  // UserRole operations
  createUserRole(userRole: Omit<UserRole, "id">): Promise<UserRole>;
  findUserRolesByUserId(userId: string, tenantId?: string | null): Promise<(UserRole & { role: Role })[]>;
  deleteUserRolesByUserId(userId: string): Promise<void>;
  
  // Permission operations
  findPermissionsByRoleId(roleId: string): Promise<Permission[]>;
  
  // Tenant operations
  findTenantById(tenantId: string): Promise<Tenant | null>;
  createTenant(tenant: Omit<Tenant, "id">): Promise<Tenant>;
  
  // Invite operations
  findInviteByToken(token: string): Promise<any | null>;
  updateInviteStatus(inviteId: string, status: string): Promise<void>;
}

// ==================== Auth Context ====================

export interface AuthContext {
  options: AuthOptions;
  adapter: AuthAdapter;
  providers: Map<string, OAuthProvider>;
  session: SessionWithUser | null;
}

// ==================== Request/Response Types ====================

export interface SignUpEmailInput {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  tenant?: { name: string } | null;
  roleName?: string;
  inviteToken?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SignInEmailInput {
  email: string;
  password: string;
  tenant_Id?: string;
  authType?: string;
  rememberMe?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SignInSocialInput {
  provider: string;
  callbackURL?: string;
  errorCallbackURL?: string;
  scopes?: string[];
  idToken?: {
    token: string;
    nonce?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
}

export interface AuthResponse {
  token: string;
  user: User;
  role: Role;
  permissions: Permission[];
  tenant?: Tenant | null;
  requiresEmailVerification?: boolean;
}

// ==================== JWT Types ====================

export interface JWTPayload {
  id: string;
  role_Id?: string;
  tenant_Id?: string | null;
  sessionToken: string;
  iat?: number;
  exp?: number;
}
