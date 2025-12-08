/**
 * Cache Types
 * Centralized cache-related type definitions
 */

/**
 * Cache configuration
 */
export interface CacheConfig {
  ex?: number; // Expiration in seconds
  [key: string]: any;
}

/**
 * Cache entry structure
 */
export interface CacheEntry {
  value: any;
  expiry: number;
  tables: string[];
  tags: string[];
  tenant?: string | null;
}

/**
 * Cache strategy type
 */
export type CacheStrategy = 'explicit' | 'all';

/**
 * Base interface for all cache adapters
 */
export interface ICacheAdapter {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttl?: number, metadata?: { tables: string[]; tags: string[]; tenant?: string | null }): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  invalidateByPattern(pattern: string): Promise<void>;
  invalidateByTables(tables: string[], tenant?: string | null): Promise<void>;
  invalidateByTags(tags: string[], tenant?: string | null): Promise<void>;
  getStats(): Promise<{ keys: number; size?: number }>;
  close(): Promise<void>;
}
