/**
 * Environment Variables Utility
 * Provides access to environment variables with validation
 */

import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class EnvironmentManager {
  private cache: Map<string, string> = new Map();

  /**
   * Get an environment variable
   */
  get(key: string, defaultValue?: string): string | undefined {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // Get from process.env
    const value = process.env[key] || defaultValue;
    
    // Cache the value
    if (value !== undefined) {
      this.cache.set(key, value);
    }

    return value;
  }

  /**
   * Get a required environment variable (throws if not found)
   */
  require(key: string): string {
    const value = this.get(key);
    if (value === undefined) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }

  /**
   * Get a boolean environment variable
   */
  getBoolean(key: string, defaultValue: boolean = false): boolean {
    const value = this.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true' || value === '1';
  }

  /**
   * Get a number environment variable
   */
  getNumber(key: string, defaultValue?: number): number | undefined {
    const value = this.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Set an environment variable (for testing)
   */
  set(key: string, value: string): void {
    process.env[key] = value;
    this.cache.set(key, value);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get all environment variables (useful for debugging)
   */
  getAll(): Record<string, string | undefined> {
    return { ...process.env };
  }
}

// Export singleton instance
const env = new EnvironmentManager();
export default env;
