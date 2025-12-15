/**
 * GitHub OAuth Provider
 */

import type { OAuthProvider, OAuth2Tokens, ProviderOptions } from "../types.js";
import {
  createAuthorizationURL,
  parseOAuth2Tokens,
} from "../oauth2/utils.js";

export interface GitHubProfile {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  bio?: string;
  company?: string;
  location?: string;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

export interface GitHubOptions extends ProviderOptions<GitHubProfile> {
  /**
   * Allow signup during OAuth flow
   */
  allowSignup?: boolean;
}

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

export function github(options: GitHubOptions): OAuthProvider<GitHubProfile, GitHubOptions> {
  const defaultScopes = ["read:user", "user:email"];

  return {
    id: "github",
    name: "GitHub",
    options,

    async createAuthorizationURL({ state, scopes, redirectURI }) {
      const allScopes = options.disableDefaultScope
        ? [...(options.scope || []), ...(scopes || [])]
        : [...defaultScopes, ...(options.scope || []), ...(scopes || [])];

      return createAuthorizationURL({
        authorizationEndpoint: GITHUB_AUTH_URL,
        clientId: options.clientId,
        redirectURI: options.redirectURI || redirectURI,
        state,
        scopes: [...new Set(allScopes)],
        additionalParams: {
          ...(options.allowSignup !== undefined && { allow_signup: String(options.allowSignup) }),
        },
      });
    },

    async validateAuthorizationCode({ code, redirectURI }) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uri: options.redirectURI || redirectURI,
      });

      const response = await fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub token exchange failed: ${response.status} ${error}`);
      }

      const data = await response.json() as Record<string, any>;

      if (data.error) {
        throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
      }

      const tokens = parseOAuth2Tokens(data);

      return {
        ...tokens,
        accessToken: data.access_token,
        tokenType: data.token_type || "Bearer",
        scopes: data.scope?.split(","),
        raw: data,
      } as OAuth2Tokens;
    },

    async getUserInfo(tokens) {
      if (!tokens.accessToken) {
        return null;
      }

      const [userResponse, emailsResponse] = await Promise.all([
        fetch(GITHUB_USER_URL, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }),
        fetch(GITHUB_EMAILS_URL, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }),
      ]);

      if (!userResponse.ok) {
        console.error("Failed to fetch GitHub user info:", await userResponse.text());
        return null;
      }

      const profile = await userResponse.json() as GitHubProfile;
      
      // Get verified primary email
      let email = profile.email;
      let emailVerified = false;

      if (emailsResponse.ok) {
        const emails = await emailsResponse.json() as GitHubEmail[];
        const primaryEmail = emails.find((e) => e.primary && e.verified);
        if (primaryEmail) {
          email = primaryEmail.email;
          emailVerified = primaryEmail.verified;
        } else {
          const verifiedEmail = emails.find((e) => e.verified);
          if (verifiedEmail) {
            email = verifiedEmail.email;
            emailVerified = verifiedEmail.verified;
          }
        }
      }

      // Parse name into first/last name
      let firstName: string | undefined;
      let lastName: string | undefined;
      if (profile.name) {
        const nameParts = profile.name.split(" ");
        firstName = nameParts[0];
        lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;
      }

      // Apply custom mapping if provided
      if (options.mapProfileToUser) {
        const mapped = await options.mapProfileToUser(profile);
        return {
          user: {
            id: profile.id.toString(),
            email: mapped.email || email || null,
            emailVerified: emailVerified,
            name: profile.name || profile.login,
            image: profile.avatar_url,
            firstName: mapped.firstName || firstName,
            lastName: mapped.lastName || lastName,
          },
          data: profile,
        };
      }

      return {
        user: {
          id: profile.id.toString(),
          email: email || null,
          emailVerified: emailVerified,
          name: profile.name || profile.login,
          image: profile.avatar_url,
          firstName,
          lastName,
        },
        data: profile,
      };
    },
  };
}

export default github;
