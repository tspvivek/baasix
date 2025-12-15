/**
 * Facebook OAuth Provider
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface FacebookProfile {
  id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  picture?: {
    data: {
      url: string;
      is_silhouette: boolean;
    };
  };
}

export interface FacebookOptions extends ProviderOptions<FacebookProfile> {
  /**
   * Fields to request from Facebook Graph API
   */
  fields?: string[];
}

const FACEBOOK_AUTH_URL = "https://www.facebook.com/v18.0/dialog/oauth";
const FACEBOOK_TOKEN_URL = "https://graph.facebook.com/v18.0/oauth/access_token";
const FACEBOOK_USERINFO_URL = "https://graph.facebook.com/v18.0/me";

export function facebook(options: FacebookOptions): OAuthProvider<FacebookProfile, FacebookOptions> {
  const defaultScopes = ["email", "public_profile"];
  const defaultFields = ["id", "name", "first_name", "last_name", "email", "picture.type(large)"];

  return {
    id: "facebook",
    name: "Facebook",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: FACEBOOK_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        prompt: options.prompt,
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const result = await validateAuthorizationCode({
        tokenEndpoint: FACEBOOK_TOKEN_URL,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectURI: options.redirectURI || redirectURI,
      });

      const tokens = parseOAuth2Tokens(result.raw);

      return {
        ...tokens,
        accessToken: result.accessToken,
        tokenType: result.tokenType,
        raw: result.raw,
      } as OAuth2Tokens;
    },

    async getUserInfo(tokens) {
      if (!tokens.accessToken) {
        return null;
      }

      const fields = options.fields || defaultFields;
      const url = new URL(FACEBOOK_USERINFO_URL);
      url.searchParams.set("fields", fields.join(","));
      url.searchParams.set("access_token", tokens.accessToken);

      const response = await fetch(url.toString());

      if (!response.ok) {
        console.error("Failed to fetch Facebook user info:", await response.text());
        return null;
      }

      const profile = await response.json() as FacebookProfile;

      // Apply custom mapping if provided
      if (options.mapProfileToUser) {
        const mapped = await options.mapProfileToUser(profile);
        return {
          user: {
            id: profile.id,
            email: mapped.email || profile.email || null,
            emailVerified: !!profile.email, // Facebook provides verified emails
            name: profile.name,
            image: profile.picture?.data?.url,
            firstName: mapped.firstName || profile.first_name,
            lastName: mapped.lastName || profile.last_name,
          },
          data: profile,
        };
      }

      return {
        user: {
          id: profile.id,
          email: profile.email || null,
          emailVerified: !!profile.email,
          name: profile.name,
          image: profile.picture?.data?.url,
          firstName: profile.first_name,
          lastName: profile.last_name,
        },
        data: profile,
      };
    },

    async refreshAccessToken(refreshToken) {
      // Facebook uses long-lived tokens and doesn't support traditional refresh
      // You would exchange a short-lived token for a long-lived one
      const url = new URL(FACEBOOK_TOKEN_URL);
      url.searchParams.set("grant_type", "fb_exchange_token");
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("client_secret", options.clientSecret);
      url.searchParams.set("fb_exchange_token", refreshToken);

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error("Failed to exchange Facebook token");
      }

      const data = await response.json() as Record<string, any>;

      return {
        accessToken: data.access_token,
        tokenType: "Bearer",
        accessTokenExpiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined,
        raw: data,
      };
    },
  };
}

export default facebook;
