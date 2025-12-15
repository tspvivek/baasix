/**
 * Providers Index
 * Export all auth providers
 */

export { google } from "./google.js";
export type { GoogleOptions, GoogleProfile } from "./google.js";

export { facebook } from "./facebook.js";
export type { FacebookOptions, FacebookProfile } from "./facebook.js";

export { apple } from "./apple.js";
export type { AppleOptions, AppleProfile } from "./apple.js";

export { github } from "./github.js";
export type { GitHubOptions, GitHubProfile } from "./github.js";

export { credential } from "./credential.js";
export type { CredentialProvider, CredentialProviderOptions } from "./credential.js";

// Provider registry
export const socialProviders = {
  google: () => import("./google.js").then((m) => m.google),
  facebook: () => import("./facebook.js").then((m) => m.facebook),
  apple: () => import("./apple.js").then((m) => m.apple),
  github: () => import("./github.js").then((m) => m.github),
} as const;

export type SocialProviderName = keyof typeof socialProviders;
