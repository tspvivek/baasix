/**
 * Utility Types
 * Miscellaneous utility type definitions
 */

import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * Schema definition (internal to SchemaManager)
 */
export interface SchemaDefinition {
  collectionName: string;
  schema: {
    fields: Record<string, any>;
    isJunction?: boolean; // True for M2M/M2A junction tables (system-generated)
    options?: {
      paranoid?: boolean;
      timestamps?: boolean;
      indexes?: Array<{
        name?: string;
        fields: string[];
        unique?: boolean;
        type?: 'BTREE' | 'HASH' | 'GIST' | 'GIN' | 'FULLTEXT';
      }>;
    };
    associations?: Record<string, {
      type: 'HasMany' | 'BelongsTo' | 'HasOne' | 'BelongsToMany' | 'M2A';
      model: string;
      foreignKey?: string;
      otherKey?: string;
      through?: string;
      as?: string;
      polymorphic?: boolean;
    }>;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Route context for Express routes
 */
export interface RouteContext {
  db: any;
  permissionService?: any;
  mailService?: any;
  storageService?: any;
}

/**
 * Cache interface (internal to cache utility)
 */
export interface CacheInterface {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}
