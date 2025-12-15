/**
 * Credential Provider
 * Handles email/password authentication
 */

import type { AuthAdapter, User, Account, AuthOptions } from "../types.js";

export interface CredentialProviderOptions {
  /**
   * Password hashing function
   */
  hashPassword: (password: string) => Promise<string>;
  /**
   * Password verification function
   */
  verifyPassword: (data: { password: string; hash: string }) => Promise<boolean>;
  /**
   * Minimum password length
   */
  minPasswordLength?: number;
  /**
   * Maximum password length
   */
  maxPasswordLength?: number;
}

export interface CredentialProvider {
  id: "credential";
  name: "Credentials";
  
  /**
   * Validate password meets requirements
   */
  validatePassword(password: string): { valid: boolean; error?: string };
  
  /**
   * Hash a password
   */
  hashPassword(password: string): Promise<string>;
  
  /**
   * Verify a password against a hash
   */
  verifyPassword(password: string, hash: string): Promise<boolean>;
  
  /**
   * Sign up a new user with credentials
   */
  signUp(data: {
    adapter: AuthAdapter;
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
    phone?: string;
  }): Promise<{ user: User; account: Account }>;
  
  /**
   * Sign in a user with credentials
   */
  signIn(data: {
    adapter: AuthAdapter;
    email: string;
    password: string;
  }): Promise<User | null>;
  
  /**
   * Change a user's password
   */
  changePassword(data: {
    adapter: AuthAdapter;
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<boolean>;
  
  /**
   * Reset a user's password (without requiring current password)
   */
  resetPassword(data: {
    adapter: AuthAdapter;
    userId: string;
    newPassword: string;
  }): Promise<boolean>;
}

export function credential(options: CredentialProviderOptions): CredentialProvider {
  const minLength = options.minPasswordLength ?? 8;
  const maxLength = options.maxPasswordLength ?? 128;

  return {
    id: "credential",
    name: "Credentials",

    validatePassword(password) {
      if (!password) {
        return { valid: false, error: "Password is required" };
      }
      if (password.length < minLength) {
        return { valid: false, error: `Password must be at least ${minLength} characters` };
      }
      if (password.length > maxLength) {
        return { valid: false, error: `Password must be at most ${maxLength} characters` };
      }
      return { valid: true };
    },

    async hashPassword(password) {
      return options.hashPassword(password);
    },

    async verifyPassword(password, hash) {
      return options.verifyPassword({ password, hash });
    },

    async signUp({ adapter, email, password, firstName, lastName, phone }) {
      // Validate password
      const validation = this.validatePassword(password);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Check if user already exists
      const existingUser = await adapter.findUserByEmail(email.toLowerCase());
      if (existingUser) {
        throw new Error("User already exists with this email");
      }

      // Hash password
      const hashedPassword = await this.hashPassword(password);

      // Create user
      const user = await adapter.createUser({
        email: email.toLowerCase(),
        emailVerified: false,
        firstName,
        lastName: lastName || null,
        phone: phone || null,
        status: "active",
      });

      // Create credential account
      const account = await adapter.createAccount({
        user_Id: user.id,
        accountId: user.id, // For credentials, accountId is same as user_Id
        providerId: "credential",
        password: hashedPassword,
      });

      return { user, account };
    },

    async signIn({ adapter, email, password }) {
      // Find user
      const user = await adapter.findUserByEmail(email.toLowerCase());
      if (!user) {
        return null;
      }

      // Check user status
      if (user.status !== "active") {
        throw new Error(`Account is ${user.status}`);
      }

      // Find credential account
      const accounts = await adapter.findAccountsByUserId(user.id);
      const credentialAccount = accounts.find((a) => a.providerId === "credential");

      // Get password - try account first, then fallback to user.password for migration
      let passwordHash: string | null | undefined = credentialAccount?.password;
      
      // If no credential account or no password in account, check user table (migration support)
      if (!passwordHash) {
        // Need to get the full user with password
        // This is a special case for migration from old password storage
        const userWithPassword = user as User & { password?: string };
        passwordHash = userWithPassword.password;
      }

      if (!passwordHash) {
        throw new Error("No password set for this account. Please reset your password or use a different sign-in method.");
      }

      // Verify password
      const isValid = await this.verifyPassword(password, passwordHash);
      if (!isValid) {
        return null;
      }

      // If password was in user table, migrate it to account table
      if (!credentialAccount?.password && passwordHash) {
        if (credentialAccount) {
          // Update existing account with password
          await adapter.updateAccount(credentialAccount.id, { password: passwordHash });
        } else {
          // Create new credential account
          await adapter.createAccount({
            user_Id: user.id,
            accountId: user.id,
            providerId: "credential",
            password: passwordHash,
          });
        }
        
        // Clear password from user table (optional - can be done later)
        // await adapter.updateUser(user.id, { password: null });
      }

      // Update last access
      await adapter.updateUser(user.id, { lastAccess: new Date() });

      return user;
    },

    async changePassword({ adapter, userId, currentPassword, newPassword }) {
      // Validate new password
      const validation = this.validatePassword(newPassword);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Find credential account
      const accounts = await adapter.findAccountsByUserId(userId);
      const credentialAccount = accounts.find((a) => a.providerId === "credential");

      if (!credentialAccount?.password) {
        throw new Error("No credential account found");
      }

      // Verify current password
      const isValid = await this.verifyPassword(currentPassword, credentialAccount.password);
      if (!isValid) {
        throw new Error("Current password is incorrect");
      }

      // Hash new password
      const hashedPassword = await this.hashPassword(newPassword);

      // Update account
      await adapter.updateAccount(credentialAccount.id, { password: hashedPassword });

      return true;
    },

    async resetPassword({ adapter, userId, newPassword }) {
      // Validate new password
      const validation = this.validatePassword(newPassword);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Hash new password
      const hashedPassword = await this.hashPassword(newPassword);

      // Find or create credential account
      const accounts = await adapter.findAccountsByUserId(userId);
      const credentialAccount = accounts.find((a) => a.providerId === "credential");

      if (credentialAccount) {
        await adapter.updateAccount(credentialAccount.id, { password: hashedPassword });
      } else {
        await adapter.createAccount({
          user_Id: userId,
          accountId: userId,
          providerId: "credential",
          password: hashedPassword,
        });
      }

      return true;
    },
  };
}

export default credential;
