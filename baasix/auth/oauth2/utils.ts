/**
 * OAuth2 Utilities
 * Common utilities for OAuth2 providers
 */

import crypto from "crypto";

/**
 * Generate a random state parameter for OAuth
 */
export function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate a code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Generate a code challenge from a verifier (for PKCE)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("base64url");
}

/**
 * Create an authorization URL with common parameters
 */
export async function createAuthorizationURL(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectURI: string;
  state: string;
  scopes?: string[];
  codeVerifier?: string;
  responseType?: string;
  prompt?: string;
  accessType?: string;
  display?: string;
  loginHint?: string;
  additionalParams?: Record<string, string>;
}): Promise<URL> {
  const {
    authorizationEndpoint,
    clientId,
    redirectURI,
    state,
    scopes,
    codeVerifier,
    responseType = "code",
    prompt,
    accessType,
    display,
    loginHint,
    additionalParams,
  } = params;

  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", responseType);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectURI);
  url.searchParams.set("state", state);

  if (scopes && scopes.length > 0) {
    url.searchParams.set("scope", scopes.join(" "));
  }

  if (codeVerifier) {
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", codeChallenge);
  }

  if (prompt) url.searchParams.set("prompt", prompt);
  if (accessType) url.searchParams.set("access_type", accessType);
  if (display) url.searchParams.set("display", display);
  if (loginHint) url.searchParams.set("login_hint", loginHint);

  if (additionalParams) {
    for (const [key, value] of Object.entries(additionalParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

/**
 * Validate an authorization code and exchange it for tokens
 */
export async function validateAuthorizationCode(params: {
  tokenEndpoint: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectURI: string;
  codeVerifier?: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
  raw: Record<string, any>;
}> {
  const { tokenEndpoint, code, clientId, clientSecret, redirectURI, codeVerifier } = params;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectURI,
  });

  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${error}`);
  }

  const data: Record<string, any> = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    tokenType: data.token_type || "Bearer",
    expiresIn: data.expires_in,
    scope: data.scope,
    raw: data,
  };
}

/**
 * Refresh an access token
 */
export async function refreshAccessToken(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  raw: Record<string, any>;
}> {
  const { tokenEndpoint, clientId, clientSecret, refreshToken } = params;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${error}`);
  }

  const data: Record<string, any> = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type || "Bearer",
    expiresIn: data.expires_in,
    raw: data,
  };
}

/**
 * Parse OAuth2 tokens from raw response
 */
export function parseOAuth2Tokens(raw: Record<string, any>): {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scopes?: string[];
} {
  const result: ReturnType<typeof parseOAuth2Tokens> = {};

  if (raw.access_token) {
    result.accessToken = raw.access_token;
  }

  if (raw.refresh_token) {
    result.refreshToken = raw.refresh_token;
  }

  if (raw.id_token) {
    result.idToken = raw.id_token;
  }

  if (raw.token_type) {
    result.tokenType = raw.token_type;
  }

  if (raw.expires_in) {
    result.accessTokenExpiresAt = new Date(Date.now() + raw.expires_in * 1000);
  }

  if (raw.refresh_token_expires_in) {
    result.refreshTokenExpiresAt = new Date(Date.now() + raw.refresh_token_expires_in * 1000);
  }

  if (raw.scope) {
    result.scopes = raw.scope.split(" ");
  }

  return result;
}

export default {
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
  createAuthorizationURL,
  validateAuthorizationCode,
  refreshAccessToken,
  parseOAuth2Tokens,
};
