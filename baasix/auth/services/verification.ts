/**
 * Verification Service
 * Handles email verification, password reset, and magic links
 */

import crypto from "crypto";
import type { AuthAdapter, Verification, User } from "../types.js";

export interface VerificationConfig {
  /**
   * Verification token expiration in seconds
   * @default 3600 (1 hour)
   */
  tokenExpiration?: number;
  /**
   * Magic link expiration in seconds
   * @default 3600 (1 hour)
   */
  magicLinkExpiration?: number;
  /**
   * Password reset expiration in seconds
   * @default 3600 (1 hour)
   */
  passwordResetExpiration?: number;
}

export type VerificationType = 
  | "email-verification"
  | "password-reset"
  | "magic-link"
  | "invite";

export interface VerificationService {
  /**
   * Generate a verification token
   */
  generateToken(): string;
  
  /**
   * Generate a short code (6-12 characters)
   */
  generateCode(length?: number): string;
  
  /**
   * Create an email verification token
   */
  createEmailVerification(email: string): Promise<{ token: string; expiresAt: Date }>;
  
  /**
   * Verify an email verification token
   */
  verifyEmail(token: string): Promise<string | null>;
  
  /**
   * Create a password reset token
   */
  createPasswordReset(email: string): Promise<{ token: string; expiresAt: Date }>;
  
  /**
   * Verify a password reset token
   */
  verifyPasswordReset(token: string): Promise<string | null>;
  
  /**
   * Create a magic link token
   */
  createMagicLink(email: string): Promise<{ token: string; expiresAt: Date }>;
  
  /**
   * Verify a magic link token
   */
  verifyMagicLink(token: string): Promise<string | null>;
  
  /**
   * Delete a verification by identifier
   */
  deleteVerification(identifier: string): Promise<void>;
}

export function createVerificationService(
  adapter: AuthAdapter,
  config: VerificationConfig = {}
): VerificationService {
  const tokenExpiration = config.tokenExpiration ?? 3600;
  const magicLinkExpiration = config.magicLinkExpiration ?? 3600;
  const passwordResetExpiration = config.passwordResetExpiration ?? 3600;

  function getIdentifier(type: VerificationType, email: string): string {
    return `${type}:${email.toLowerCase()}`;
  }

  return {
    generateToken() {
      return crypto.randomBytes(32).toString("hex");
    },

    generateCode(length = 6) {
      const bytes = crypto.randomBytes(Math.ceil(length / 2));
      return bytes.toString("hex").slice(0, length).toUpperCase();
    },

    async createEmailVerification(email) {
      const identifier = getIdentifier("email-verification", email);
      
      // Delete any existing verification
      await adapter.deleteVerificationByIdentifier(identifier);
      
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + tokenExpiration * 1000);
      
      await adapter.createVerification({
        identifier,
        value: token,
        expiresAt,
      });
      
      return { token, expiresAt };
    },

    async verifyEmail(token) {
      // Find verification by token
      // Note: This is a simplistic approach - in production you'd want an index on value
      const verifications = await findVerificationByToken(adapter, "email-verification", token);
      
      if (!verifications) {
        return null;
      }
      
      // Check expiration
      if (new Date() > new Date(verifications.expiresAt)) {
        await adapter.deleteVerification(verifications.id);
        return null;
      }
      
      // Extract email from identifier
      const email = verifications.identifier.replace("email-verification:", "");
      
      // Delete the verification
      await adapter.deleteVerification(verifications.id);
      
      return email;
    },

    async createPasswordReset(email) {
      const identifier = getIdentifier("password-reset", email);
      
      // Delete any existing verification
      await adapter.deleteVerificationByIdentifier(identifier);
      
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + passwordResetExpiration * 1000);
      
      await adapter.createVerification({
        identifier,
        value: token,
        expiresAt,
      });
      
      return { token, expiresAt };
    },

    async verifyPasswordReset(token) {
      const verifications = await findVerificationByToken(adapter, "password-reset", token);
      
      if (!verifications) {
        return null;
      }
      
      // Check expiration
      if (new Date() > new Date(verifications.expiresAt)) {
        await adapter.deleteVerification(verifications.id);
        return null;
      }
      
      // Extract email from identifier
      const email = verifications.identifier.replace("password-reset:", "");
      
      // Delete the verification
      await adapter.deleteVerification(verifications.id);
      
      return email;
    },

    async createMagicLink(email) {
      const identifier = getIdentifier("magic-link", email);
      
      // Delete any existing verification
      await adapter.deleteVerificationByIdentifier(identifier);
      
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + magicLinkExpiration * 1000);
      
      await adapter.createVerification({
        identifier,
        value: token,
        expiresAt,
      });
      
      return { token, expiresAt };
    },

    async verifyMagicLink(token) {
      const verifications = await findVerificationByToken(adapter, "magic-link", token);
      
      if (!verifications) {
        return null;
      }
      
      // Check expiration
      if (new Date() > new Date(verifications.expiresAt)) {
        await adapter.deleteVerification(verifications.id);
        return null;
      }
      
      // Extract email from identifier
      const email = verifications.identifier.replace("magic-link:", "");
      
      // Delete the verification
      await adapter.deleteVerification(verifications.id);
      
      return email;
    },

    async deleteVerification(identifier) {
      await adapter.deleteVerificationByIdentifier(identifier);
    },
  };
}

/**
 * Helper to find verification by token
 * This is a workaround since we're storing token in 'value' field
 */
async function findVerificationByToken(
  adapter: AuthAdapter,
  type: VerificationType,
  token: string
): Promise<Verification | null> {
  // Get the service to do a raw query
  // This is a limitation of the adapter interface - we'd need to add a findByValue method
  try {
    const ItemsService = (await import("../../services/ItemsService.js")).default;
    const service = new ItemsService("baasix_Verification", { accountability: undefined });
    
    const result = await service.readByQuery({
      filter: {
        value: { eq: token },
        identifier: { startsWith: `${type}:` },
      },
      limit: 1,
    });
    
    return result.data?.[0] || null;
  } catch {
    return null;
  }
}

export default createVerificationService;
