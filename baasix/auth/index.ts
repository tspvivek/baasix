/**
 * Baasix Auth Module
 * 
 * A flexible authentication module inspired by better-auth architecture.
 * Supports multiple authentication strategies through adapters and providers.
 * 
 * Features:
 * - Email/Password authentication
 * - OAuth2 social authentication (Google, Facebook, Apple, GitHub)
 * - Session management
 * - JWT token handling
 * - Email verification
 * - Password reset
 * - Magic links
 * - Multi-tenant support
 * - Session limits
 * 
 * @example
 * ```typescript
 * import { createAuth, createAuthRoutes, createAuthMiddleware } from './auth';
 * 
 * // Create auth instance
 * const auth = createAuth({
 *   secret: process.env.SECRET_KEY,
 *   emailAndPassword: { enabled: true },
 *   socialProviders: {
 *     google: {
 *       clientId: process.env.GOOGLE_CLIENT_ID,
 *       clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *     },
 *   },
 * });
 * 
 * // Register routes
 * createAuthRoutes(app, {
 *   secret: process.env.SECRET_KEY,
 *   // ... other options
 * });
 * 
 * // Use middleware
 * app.use(createAuthMiddleware(auth));
 * ```
 */

// Core
export { createAuth } from "./core.js";
export type { BaasixAuth } from "./core.js";

// Routes
export { createAuthRoutes, createAuthMiddleware, setTokenInResponse } from "./routes.js";
export type { AuthRouteOptions } from "./routes.js";

// Types
export * from "./types.js";

// Adapters
export { createBaasixAdapter } from "./adapters/index.js";
export type { AuthAdapter } from "./adapters/index.js";

// Providers
export { google, facebook, apple, github, credential } from "./providers/index.js";
export type {
  GoogleOptions,
  GoogleProfile,
  FacebookOptions,
  FacebookProfile,
  AppleOptions,
  AppleProfile,
  GitHubOptions,
  GitHubProfile,
  CredentialProvider,
  CredentialProviderOptions,
  SocialProviderName,
} from "./providers/index.js";

// Services
export {
  createSessionService,
  createTokenService,
  createVerificationService,
  validateSessionLimits,
} from "./services/index.js";
export type {
  SessionConfig,
  SessionService,
  SessionLimitConfig,
  TokenConfig,
  TokenService,
  VerificationConfig,
  VerificationService,
  VerificationType,
} from "./services/index.js";

// OAuth2 Utilities
export {
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "./oauth2/index.js";
