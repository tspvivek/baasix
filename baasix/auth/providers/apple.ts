/**
 * Apple OAuth Provider
 */

import crypto from "crypto";
import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface AppleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  real_user_status?: number;
}
export interface AppleOptions extends ProviderOptions<AppleProfile> {
  /**
   * Team ID from Apple Developer Portal
   */
  teamId: string;
  /**
   * Key ID from Apple Developer Portal
   */
  keyId: string;
  /**
   * Private key in PEM format
   */
  privateKey: string;
}

const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";

/**
 * Generate a client secret for Apple Sign In
 */
function generateClientSecret(options: AppleOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: options.keyId,
  };
  const payload = {
    iss: options.teamId,
    iat: now,
    exp: now + 86400 * 180, // 180 days
    aud: "https://appleid.apple.com",
    sub: options.clientId,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signatureInput = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign("SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(options.privateKey, "base64url");

  return `${signatureInput}.${signature}`;
}

/**
 * Decode Apple ID token
 */
function decodeIdToken(idToken: string): AppleProfile | null {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return payload;
  } catch {
    return null;
  }
}

export function apple(options: AppleOptions): OAuthProvider<AppleProfile, AppleOptions> {
  const defaultScopes = ["name", "email"];

  return {
    id: "apple",
    name: "Apple",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: APPLE_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        responseType: "code",
        additionalParams: {
          response_mode: "form_post",
        },
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const clientSecret = generateClientSecret(options);

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: options.clientId,
        client_secret: clientSecret,
        redirect_uri: options.redirectURI || redirectURI,
      });

      const response = await fetch(APPLE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Apple token exchange failed: ${response.status} ${error}`);
      }

      const data = await response.json() as Record<string, any>;
      const tokens = parseOAuth2Tokens(data);

      return {
        ...tokens,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
        tokenType: data.token_type || "Bearer",
        raw: data,
      } as OAuth2Tokens;
    },

    async getUserInfo(tokens) {
      // Apple doesn't have a userinfo endpoint
      // User info comes from the ID token
      if (!tokens.idToken) {
        return null;
      }

      const profile = decodeIdToken(tokens.idToken);
      if (!profile) {
        return null;
      }

      // Apply custom mapping if provided
      if (options.mapProfileToUser) {
        const mapped = await options.mapProfileToUser(profile);
        return {
          user: {
            id: profile.sub,
            email: mapped.email || profile.email || null,
            emailVerified: profile.email_verified === true || profile.email_verified === "true",
            name: undefined,
            firstName: mapped.firstName,
            lastName: mapped.lastName,
          },
          data: profile,
        };
      }

      return {
        user: {
          id: profile.sub,
          email: profile.email || null,
          emailVerified: profile.email_verified === true || profile.email_verified === "true",
          name: undefined,
        },
        data: profile,
      };
    },

    async refreshAccessToken(refreshToken) {
      const clientSecret = generateClientSecret(options);

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: options.clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      });

      const response = await fetch(APPLE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error("Failed to refresh Apple token");
      }

      const data = await response.json() as Record<string, any>;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
        tokenType: data.token_type || "Bearer",
        accessTokenExpiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined,
        raw: data,
      };
    },

    async verifyIdToken(token, _nonce) {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return false;
        
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        
        // Check expiration
        if (payload.exp && payload.exp < Date.now() / 1000) {
          return false;
        }
        
        // Check issuer
        if (payload.iss !== "https://appleid.apple.com") {
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

export default apple;
