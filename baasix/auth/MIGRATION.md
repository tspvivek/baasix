# Auth Module v2 Migration Guide

This document describes how to migrate from the old PassportJS-based auth module to the new adapter-based auth module.

## Overview

The new auth module is designed to be:
- **Modular**: Separated into adapters, providers, and services
- **Extensible**: Easy to add new providers or adapters
- **Independent**: Can be extracted as a separate package
- **Better-Auth inspired**: Following patterns from the better-auth library

## Architecture

```
auth/
├── types.ts          # Core type definitions
├── adapters/         # Database adapters
│   ├── baasix-adapter.ts   # Baasix ItemsService adapter
│   └── index.ts
├── oauth2/           # OAuth2 utilities
│   ├── utils.ts      # State, PKCE, token exchange
│   └── index.ts
├── providers/        # Auth providers
│   ├── google.ts     # Google OAuth
│   ├── facebook.ts   # Facebook OAuth
│   ├── apple.ts      # Apple OAuth
│   ├── github.ts     # GitHub OAuth
│   ├── credential.ts # Email/Password
│   └── index.ts
├── services/         # Core services
│   ├── session.ts    # Session management
│   ├── token.ts      # JWT token service
│   ├── verification.ts # Email verification, magic links
│   └── index.ts
├── core.ts           # Main BaasixAuth implementation
├── routes.ts         # Express route handlers
└── index.ts          # Main exports
```

## Migration Steps

### Step 1: Update Dependencies

The new module uses:
- `jsonwebtoken` for JWT (already used)
- `argon2` for password hashing (already used)
- Native `crypto` for OAuth2 state/PKCE

You can remove these PassportJS dependencies from `package.json`:
```json
{
  "dependencies": {
    // Remove these:
    "passport": "...",
    "passport-jwt": "...",
    "passport-local": "...",
    "passport-google-oauth20": "...",
    "passport-facebook": "...",
    "passport-apple": "..."
  }
}
```

### Step 2: Update app.ts

Replace the old auth middleware import:

```typescript
// Old:
import { authMiddleware } from "./utils/auth.js";

// New (option 1 - use new standalone middleware):
import { authMiddleware } from "./utils/auth.v2.js";

// New (option 2 - use auth module's middleware):
import { createAuthMiddleware } from "./auth/index.js";
const authMiddleware = createAuthMiddleware({
  secret: env.get("SECRET_KEY") || "",
});
```

### Step 3: Update Auth Routes

Replace the old auth route:

```typescript
// Old: The route is loaded automatically from routes/auth.route.ts

// New: You can either:
// 1. Replace auth.route.ts with auth.route.v2.ts
// 2. Or use createAuthRoutes directly in app.ts:

import { createAuthRoutes } from "./auth/index.js";

// In your initialization:
createAuthRoutes(app, {
  secret: env.get("SECRET_KEY") || "",
  baseURL: env.get("BASE_URL"),
  socialProviders: {
    google: env.get("GOOGLE_CLIENT_ID") ? {
      clientId: env.get("GOOGLE_CLIENT_ID"),
      clientSecret: env.get("GOOGLE_CLIENT_SECRET"),
    } : undefined,
    // ... other providers
  },
  mailService: {
    sendMail: async (options) => {
      await mailService.sendMail(options);
    },
  },
});
```

### Step 4: Password Migration

The new module supports automatic password migration from User to Account table:

```typescript
// The credential provider checks:
// 1. Account table for provider='credential' with password
// 2. If not found, checks User.password field
// 3. If User.password exists, creates Account entry and clears User.password

// No action needed - migration happens on first login
```

## API Endpoints

The new module provides these endpoints (default basePath: `/auth`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/register` | POST | Register new user |
| `/auth/login` | POST | Login with credentials |
| `/auth/logout` | GET | Logout user |
| `/auth/me` | GET | Get current user info |
| `/auth/check` | GET | Check auth status |
| `/auth/social/signin` | POST | Start OAuth flow |
| `/auth/callback/:provider` | GET | OAuth callback |
| `/auth/magiclink` | POST | Request magic link |
| `/auth/magiclink/:token` | GET | Verify magic link |
| `/auth/password/reset` | POST | Request password reset |
| `/auth/password/reset/:token` | POST | Reset password with token |
| `/auth/password/change` | POST | Change password (authenticated) |
| `/auth/email/verify` | POST | Request email verification |
| `/auth/email/verify/:token` | GET | Verify email |
| `/auth/tenants` | GET | List user's tenants |
| `/auth/switch-tenant` | POST | Switch active tenant |

## Invitation System

The invitation endpoints remain in `auth.route.v2.ts`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/invite` | POST | Send invitation |
| `/auth/verify-invite/:token` | GET | Verify invitation |
| `/auth/accept-invite` | POST | Accept invitation |

## Using the Auth Module Programmatically

```typescript
import { createAuth } from "./auth/index.js";

const auth = createAuth({
  secret: "your-secret-key",
  baseURL: "https://api.example.com",
  socialProviders: {
    google: {
      clientId: "...",
      clientSecret: "...",
    },
  },
});

// Sign up
const result = await auth.signUp({
  email: "user@example.com",
  password: "secure-password",
  firstName: "John",
  lastName: "Doe",
});

// Sign in
const session = await auth.signIn({
  email: "user@example.com",
  password: "secure-password",
});

// Validate session
const user = await auth.validateSession(token);

// Get OAuth URL
const { url, state, codeVerifier } = await auth.getOAuthUrl("google", {
  redirectURI: "https://app.example.com/callback",
});

// Handle OAuth callback
const oauthResult = await auth.handleOAuthCallback("google", code, {
  state,
  codeVerifier,
  redirectURI: "https://app.example.com/callback",
});
```

## Environment Variables

Required environment variables:

```env
# Core
SECRET_KEY=your-jwt-secret
JWT_SECRET=your-jwt-secret  # Alias for SECRET_KEY
BASE_URL=https://api.example.com
AUTH_APP_URL=https://app.example.com

# Multi-tenant (optional)
MULTI_TENANT=true

# OAuth providers (optional)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
FACEBOOK_CLIENT_ID=...
FACEBOOK_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
APPLE_CLIENT_ID=...
APPLE_CLIENT_SECRET=...
APPLE_TEAM_ID=...
APPLE_KEY_ID=...
APPLE_PRIVATE_KEY=...

# Session
ACCESS_TOKEN_EXPIRES_IN=604800  # 7 days in seconds
```

## Custom Adapter

To create a custom adapter (e.g., for a different database):

```typescript
import type { AuthAdapter } from "./auth/types.js";

export function createMyAdapter(): AuthAdapter {
  return {
    // User operations
    createUser: async (data) => { /* ... */ },
    findUserByEmail: async (email) => { /* ... */ },
    findUserById: async (id) => { /* ... */ },
    updateUser: async (id, data) => { /* ... */ },
    
    // Account operations (for OAuth)
    findAccountByProvider: async (userId, providerId) => { /* ... */ },
    findAccountByProviderAccountId: async (providerId, accountId) => { /* ... */ },
    createAccount: async (data) => { /* ... */ },
    updateAccount: async (id, data) => { /* ... */ },
    
    // Session operations
    createSession: async (data) => { /* ... */ },
    findSessionByToken: async (token) => { /* ... */ },
    updateSession: async (id, data) => { /* ... */ },
    deleteSession: async (id) => { /* ... */ },
    deleteSessionsByUserId: async (userId) => { /* ... */ },
    countSessionsByUserAndType: async (userId, type) => { /* ... */ },
    
    // Verification operations
    createVerification: async (data) => { /* ... */ },
    findVerification: async (token, type) => { /* ... */ },
    deleteVerification: async (id) => { /* ... */ },
    
    // Role & Permission operations
    findUserRoleForTenant: async (userId, tenantId) => { /* ... */ },
    findUserDefaultRole: async (userId) => { /* ... */ },
    findRolePermissions: async (roleId) => { /* ... */ },
    createUserRole: async (data) => { /* ... */ },
    
    // Tenant operations
    findTenantById: async (id) => { /* ... */ },
    createTenant: async (data) => { /* ... */ },
  };
}
```

## Custom Provider

To create a custom OAuth provider:

```typescript
import type { OAuthProvider, OAuthProviderConfig } from "./auth/types.js";

export function createMyProvider(config: OAuthProviderConfig): OAuthProvider {
  return {
    id: "my-provider",
    name: "My Provider",
    
    createAuthorizationURL: async (options) => {
      const url = new URL("https://provider.com/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", options.redirectURI);
      url.searchParams.set("state", options.state);
      // Add PKCE if supported
      if (options.codeChallenge) {
        url.searchParams.set("code_challenge", options.codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
      }
      return url.toString();
    },
    
    validateAuthorizationCode: async (code, options) => {
      // Exchange code for tokens
      const response = await fetch("https://provider.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret!,
          redirect_uri: options.redirectURI!,
          code_verifier: options.codeVerifier!,
        }),
      });
      return response.json();
    },
    
    getUserInfo: async (tokens) => {
      const response = await fetch("https://provider.com/userinfo", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      const data = await response.json();
      return {
        id: data.id,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        picture: data.avatar,
        emailVerified: data.email_verified,
        raw: data,
      };
    },
  };
}
```

## Troubleshooting

### Token Validation Issues

If tokens from the old system stop working:
1. The new module uses the same JWT secret (`SECRET_KEY`)
2. Both systems expect `sessionToken` in the payload
3. Check that `expiresIn` format is compatible

### OAuth Callback Issues

1. Make sure callback URLs are registered with OAuth providers
2. The callback path is `${basePath}/callback/${provider}`
3. Apple Sign In uses POST for callbacks

### Session Limits

Session limits are enforced based on the `sessionLimits` setting:
```typescript
// Default limits (from settings or env)
{
  default: 5,   // Max sessions per user
  mobile: 3,    // Max mobile sessions
  api: 10,      // Max API sessions
}
```

## Breaking Changes

1. **No more PassportJS strategies** - OAuth is handled directly
2. **Account table for OAuth** - OAuth credentials stored in Account, not User
3. **Password in Account** - Passwords can be migrated to Account table
4. **Session tokens** - Sessions are stored in database, not just JWT

## Support

For issues or questions about the migration, refer to:
- `/api/baasix/auth/` - Source code
- `CLAUDE.md` - Project conventions
- `api/test/auth.test.js` - Test examples
