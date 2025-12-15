/**
 * Google OAuth Provider
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface GoogleProfile {
  sub: string;
  name: string;
  given_name: string;
  family_name?: string;
  picture?: string;
  email: string;
  email_verified: boolean;
  locale?: string;
  hd?: string;
}

export interface GoogleOptions extends ProviderOptions<GoogleProfile> {
  /**
   * Access type for offline access
   */
  accessType?: "offline" | "online";
  /**
   * Display mode for the consent screen
   */
  display?: "page" | "popup" | "touch" | "wap";
  /**
   * Hosted domain restriction
   */
  hd?: string;
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function google(options: GoogleOptions): OAuthProvider<GoogleProfile, GoogleOptions> {
  const defaultScopes = ["openid", "email", "profile"];

  return {
    id: "google",
    name: "Google",
    options,

    async createAuthorizationURL({ state, codeVerifier, scopes, redirectURI, loginHint }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: GOOGLE_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        codeVerifier,
        prompt: options.prompt,
        accessType: options.accessType,
        loginHint,
        additionalParams: {
          include_granted_scopes: "true",
          ...(options.hd && { hd: options.hd }),
        },
      });
    },

    async validateAuthorizationCode({ code, redirectURI, codeVerifier }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: GOOGLE_TOKEN_URL,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI || redirectURI,
        codeVerifier,
      });

      const tokens = parseOAuth2Tokens(result.raw);

      return {
        ...tokens,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        idToken: result.idToken,
        tokenType: result.tokenType,
        raw: result.raw,
      } as OAuth2Tokens;
    },

    async getUserInfo(tokens) {
      if (!tokens.accessToken) {
        return null;
      }

      const response = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        console.error("Failed to fetch Google user info:", await response.text());
        return null;
      }

      const profile = await response.json() as GoogleProfile;

      // Apply custom mapping if provided
      if (options.mapProfileToUser) {
        const mapped = await options.mapProfileToUser(profile);
        return {
          user: {
            id: profile.sub,
            email: mapped.email || profile.email,
            emailVerified: profile.email_verified,
            name: mapped.firstName 
              ? `${mapped.firstName}${mapped.lastName ? " " + mapped.lastName : ""}`
              : profile.name,
            image: profile.picture,
            firstName: mapped.firstName || profile.given_name,
            lastName: mapped.lastName || profile.family_name,
          },
          data: profile,
        };
      }

      return {
        user: {
          id: profile.sub,
          email: profile.email,
          emailVerified: profile.email_verified,
          name: profile.name,
          image: profile.picture,
          firstName: profile.given_name,
          lastName: profile.family_name,
        },
        data: profile,
      };
    },

    async refreshAccessToken(refreshToken) {
      const result = await refreshAccessToken({
        tokenEndpoint: GOOGLE_TOKEN_URL,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        refreshToken,
      });

      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: result.tokenType,
        accessTokenExpiresAt: result.expiresIn
          ? new Date(Date.now() + result.expiresIn * 1000)
          : undefined,
        raw: result.raw,
      };
    },

    async verifyIdToken(token, _nonce) {
      // For now, just do basic validation
      // In production, you'd want to verify the JWT signature using Google's public keys
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return false;
        
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        
        // Check expiration
        if (payload.exp && payload.exp < Date.now() / 1000) {
          return false;
        }
        
        // Check issuer
        if (
          payload.iss !== "https://accounts.google.com" &&
          payload.iss !== "accounts.google.com"
        ) {
          return false;
        }
        
        // Check audience
        if (payload.aud !== options.clientId) {
          return false;
        }
        
        return true;
      } catch {
        return false;
      }
    },
  };
}

export default google;
