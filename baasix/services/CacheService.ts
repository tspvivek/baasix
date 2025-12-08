/**
 * CacheService - Comprehensive caching solution for Drizzle ORM
 *
 * Features:
 * - Multiple adapters: InMemory, Redis/Valkey, Upstash
 * - Tenant-specific caching when multi-tenancy is enabled
 * - Global cache with immediate invalidation
 * - Automatic invalidation on create/update/delete operations
 * - Integration with Drizzle's Cache class
 * - Pattern-based cache key management
 */

import env from '../utils/env.js';
import type { Table } from 'drizzle-orm';
import type { CacheConfig, CacheEntry, CacheStrategy, ICacheAdapter } from '../types/index.js';

// Re-export types for backward compatibility
export type { CacheConfig, CacheEntry, CacheStrategy, ICacheAdapter };

// ============================================================================
// IN-MEMORY CACHE ADAPTER
// ============================================================================

export class InMemoryCacheAdapter implements ICacheAdapter {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSizeGB: number = 1) {
    this.maxSize = maxSizeGB * 1024 * 1024 * 1024; // Convert GB to bytes

    if(env.get('TEST_MODE') !== 'true') {
      // Start periodic cleanup of expired entries (every 5 minutes)
      this.cleanupInterval = setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
    }
  }

  async get(key: string): Promise<any | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(
    key: string,
    value: any,
    ttl: number = 3600,
    metadata?: { tables: string[]; tags: string[]; tenant?: string | null }
  ): Promise<void> {
    await this.ensureCapacity();

    const entry: CacheEntry = {
      value,
      expiry: Date.now() + (ttl * 1000),
      tables: metadata?.tables || [],
      tags: metadata?.tags || [],
      tenant: metadata?.tenant,
    };

    this.cache.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async invalidateByPattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  async invalidateByTables(tables: string[], tenant?: string | null): Promise<void> {
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      // Check tenant match if multi-tenant
      if (tenant !== undefined && entry.tenant !== tenant) {
        continue;
      }

      // Check if entry involves any of the specified tables
      const hasTable = entry.tables.some(t => tables.includes(t));
      if (hasTable) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  async invalidateByTags(tags: string[], tenant?: string | null): Promise<void> {
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      // Check tenant match if multi-tenant
      if (tenant !== undefined && entry.tenant !== tenant) {
        continue;
      }

      // Check if entry has any of the specified tags
      const hasTag = entry.tags.some(t => tags.includes(t));
      if (hasTag) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  async getStats(): Promise<{ keys: number; size: number }> {
    const size = this.getCurrentSize();
    return { keys: this.cache.size, size };
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }

  private getCurrentSize(): number {
    let size = 0;
    for (const entry of this.cache.values()) {
      size += JSON.stringify(entry).length;
    }
    return size;
  }

  private async ensureCapacity(): Promise<void> {
    const currentSize = this.getCurrentSize();

    if (currentSize > this.maxSize) {
      // Free 20% of cache by removing oldest entries
      const amountToFree = this.maxSize * 0.2;
      let freedSize = 0;

      // Sort by expiry time (oldest first)
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].expiry - b[1].expiry);

      for (const [key, entry] of entries) {
        if (freedSize >= amountToFree) break;

        const size = JSON.stringify(entry).length;
        this.cache.delete(key);
        freedSize += size;
      }

      console.log(`[InMemoryCache] Freed ${freedSize} bytes`);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < now) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }

    if (expiredKeys.length > 0) {
      console.log(`[InMemoryCache] Cleaned up ${expiredKeys.length} expired entries`);
    }
  }
}

// ============================================================================
// REDIS/VALKEY CACHE ADAPTER
// ============================================================================

export class RedisCacheAdapter implements ICacheAdapter {
  private client: any; // Redis instance
  private metadataPrefix = '_meta:';

  constructor(redisClient: any) {
    this.client = redisClient;
  }

  async get(key: string): Promise<any | null> {
    try {
      const value = await this.client.get(key);
      if (!value) return null;

      return JSON.parse(value);
    } catch (error) {
      console.error(`[RedisCache] Error getting key ${key}:`, error);
      return null;
    }
  }

  async set(
    key: string,
    value: any,
    ttl: number = 3600,
    metadata?: { tables: string[]; tags: string[]; tenant?: string | null }
  ): Promise<void> {
    try {
      // Store the actual value
      await this.client.set(key, JSON.stringify(value), 'EX', ttl);

      // Store metadata for invalidation purposes
      if (metadata) {
        const metaKey = this.metadataPrefix + key;
        await this.client.set(metaKey, JSON.stringify(metadata), 'EX', ttl);
      }
    } catch (error) {
      console.error(`[RedisCache] Error setting key ${key}:`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
      await this.client.del(this.metadataPrefix + key);
    } catch (error) {
      console.error(`[RedisCache] Error deleting key ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.flushdb();
    } catch (error) {
      console.error('[RedisCache] Error clearing cache:', error);
    }
  }

  async invalidateByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);

        // Also delete metadata keys
        const metaKeys = keys.map((k: string) => this.metadataPrefix + k);
        await this.client.del(...metaKeys);
      }
    } catch (error) {
      console.error(`[RedisCache] Error invalidating pattern ${pattern}:`, error);
    }
  }

  async invalidateByTables(tables: string[], tenant?: string | null): Promise<void> {
    try {
      // Get all metadata keys
      const metaKeys = await this.client.keys(this.metadataPrefix + '*');
      const keysToDelete: string[] = [];

      for (const metaKey of metaKeys) {
        const metadata = await this.client.get(metaKey);
        if (!metadata) continue;

        try {
          const meta = JSON.parse(metadata);

          // Check tenant match if multi-tenant
          if (tenant !== undefined && meta.tenant !== tenant) {
            continue;
          }

          // Check if metadata involves any of the specified tables
          const hasTable = meta.tables?.some((t: string) => tables.includes(t));
          if (hasTable) {
            const originalKey = metaKey.substring(this.metadataPrefix.length);
            keysToDelete.push(originalKey);
            keysToDelete.push(metaKey);
          }
        } catch (e) {
          // Skip invalid metadata
        }
      }

      if (keysToDelete.length > 0) {
        await this.client.del(...keysToDelete);
        console.log(`[RedisCache] Invalidated ${keysToDelete.length / 2} entries for tables: ${tables.join(', ')}`);
      }
    } catch (error) {
      console.error('[RedisCache] Error invalidating by tables:', error);
    }
  }

  async invalidateByTags(tags: string[], tenant?: string | null): Promise<void> {
    try {
      // Get all metadata keys
      const metaKeys = await this.client.keys(this.metadataPrefix + '*');
      const keysToDelete: string[] = [];

      for (const metaKey of metaKeys) {
        const metadata = await this.client.get(metaKey);
        if (!metadata) continue;

        try {
          const meta = JSON.parse(metadata);

          // Check tenant match if multi-tenant
          if (tenant !== undefined && meta.tenant !== tenant) {
            continue;
          }

          // Check if metadata has any of the specified tags
          const hasTag = meta.tags?.some((t: string) => tags.includes(t));
          if (hasTag) {
            const originalKey = metaKey.substring(this.metadataPrefix.length);
            keysToDelete.push(originalKey);
            keysToDelete.push(metaKey);
          }
        } catch (e) {
          // Skip invalid metadata
        }
      }

      if (keysToDelete.length > 0) {
        await this.client.del(...keysToDelete);
        console.log(`[RedisCache] Invalidated ${keysToDelete.length / 2} entries for tags: ${tags.join(', ')}`);
      }
    } catch (error) {
      console.error('[RedisCache] Error invalidating by tags:', error);
    }
  }

  async getStats(): Promise<{ keys: number; size?: number }> {
    try {
      const info = await this.client.info('memory');
      const keys = await this.client.dbsize();

      const match = info.match(/used_memory:(\d+)/);
      const size = match ? parseInt(match[1]) : undefined;

      return { keys, size };
    } catch (error) {
      console.error('[RedisCache] Error getting stats:', error);
      return { keys: 0 };
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      console.error('[RedisCache] Error closing connection:', error);
    }
  }
}

// ============================================================================
// UPSTASH CACHE ADAPTER
// ============================================================================

export class UpstashCacheAdapter implements ICacheAdapter {
  private client: any; // Upstash Redis instance
  private metadataPrefix = '_meta:';

  constructor(upstashClient: any) {
    this.client = upstashClient;
  }

  async get(key: string): Promise<any | null> {
    try {
      const value = await this.client.get(key);
      if (!value) return null;

      // Upstash may return parsed JSON directly
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
      console.error(`[UpstashCache] Error getting key ${key}:`, error);
      return null;
    }
  }

  async set(
    key: string,
    value: any,
    ttl: number = 3600,
    metadata?: { tables: string[]; tags: string[]; tenant?: string | null }
  ): Promise<void> {
    try {
      // Store the actual value with TTL
      await this.client.set(key, JSON.stringify(value), { ex: ttl });

      // Store metadata for invalidation purposes
      if (metadata) {
        const metaKey = this.metadataPrefix + key;
        await this.client.set(metaKey, JSON.stringify(metadata), { ex: ttl });
      }
    } catch (error) {
      console.error(`[UpstashCache] Error setting key ${key}:`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
      await this.client.del(this.metadataPrefix + key);
    } catch (error) {
      console.error(`[UpstashCache] Error deleting key ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.flushdb();
    } catch (error) {
      console.error('[UpstashCache] Error clearing cache:', error);
    }
  }

  async invalidateByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);

        // Also delete metadata keys
        const metaKeys = keys.map((k: string) => this.metadataPrefix + k);
        await this.client.del(...metaKeys);
      }
    } catch (error) {
      console.error(`[UpstashCache] Error invalidating pattern ${pattern}:`, error);
    }
  }

  async invalidateByTables(tables: string[], tenant?: string | null): Promise<void> {
    try {
      // Get all metadata keys
      const metaKeys = await this.client.keys(this.metadataPrefix + '*');
      const keysToDelete: string[] = [];

      for (const metaKey of metaKeys) {
        const metadata = await this.client.get(metaKey);
        if (!metadata) continue;

        try {
          const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

          // Check tenant match if multi-tenant
          if (tenant !== undefined && meta.tenant !== tenant) {
            continue;
          }

          // Check if metadata involves any of the specified tables
          const hasTable = meta.tables?.some((t: string) => tables.includes(t));
          if (hasTable) {
            const originalKey = metaKey.substring(this.metadataPrefix.length);
            keysToDelete.push(originalKey);
            keysToDelete.push(metaKey);
          }
        } catch (e) {
          // Skip invalid metadata
        }
      }

      if (keysToDelete.length > 0) {
        await this.client.del(...keysToDelete);
        console.log(`[UpstashCache] Invalidated ${keysToDelete.length / 2} entries for tables: ${tables.join(', ')}`);
      }
    } catch (error) {
      console.error('[UpstashCache] Error invalidating by tables:', error);
    }
  }

  async invalidateByTags(tags: string[], tenant?: string | null): Promise<void> {
    try {
      // Get all metadata keys
      const metaKeys = await this.client.keys(this.metadataPrefix + '*');
      const keysToDelete: string[] = [];

      for (const metaKey of metaKeys) {
        const metadata = await this.client.get(metaKey);
        if (!metadata) continue;

        try {
          const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

          // Check tenant match if multi-tenant
          if (tenant !== undefined && meta.tenant !== tenant) {
            continue;
          }

          // Check if metadata has any of the specified tags
          const hasTag = meta.tags?.some((t: string) => tags.includes(t));
          if (hasTag) {
            const originalKey = metaKey.substring(this.metadataPrefix.length);
            keysToDelete.push(originalKey);
            keysToDelete.push(metaKey);
          }
        } catch (e) {
          // Skip invalid metadata
        }
      }

      if (keysToDelete.length > 0) {
        await this.client.del(...keysToDelete);
        console.log(`[UpstashCache] Invalidated ${keysToDelete.length / 2} entries for tags: ${tags.join(', ')}`);
      }
    } catch (error) {
      console.error('[UpstashCache] Error invalidating by tags:', error);
    }
  }

  async getStats(): Promise<{ keys: number; size?: number }> {
    try {
      const keys = await this.client.dbsize();
      return { keys };
    } catch (error) {
      console.error('[UpstashCache] Error getting stats:', error);
      return { keys: 0 };
    }
  }

  async close(): Promise<void> {
    // Upstash connections are typically managed differently
    // No explicit close needed for HTTP-based Upstash client
  }
}

// ============================================================================
// DRIZZLE CACHE IMPLEMENTATION
// ============================================================================

/**
 * BaasixDrizzleCache - Implements Drizzle's cache interface
 * Integrates with our adapter system and provides tenant-aware caching
 */
export class BaasixDrizzleCache {
  private adapter: ICacheAdapter;
  private defaultTTL: number;
  private cacheStrategy: CacheStrategy;
  private multiTenant: boolean;
  private currentTenant: string | null = null;

  constructor(
    adapter: ICacheAdapter,
    options: {
      strategy?: CacheStrategy;
      defaultTTL?: number;
      multiTenant?: boolean;
    } = {}
  ) {
    this.adapter = adapter;
    this.cacheStrategy = options.strategy || 'explicit';
    this.defaultTTL = options.defaultTTL || 3600;
    this.multiTenant = options.multiTenant || false;
  }

  /**
   * Set the current tenant context for cache operations
   */
  setTenant(tenantId: string | null): void {
    this.currentTenant = tenantId;
  }

  /**
   * Get the current tenant context
   */
  getTenant(): string | null {
    return this.currentTenant;
  }

  /**
   * Drizzle Cache interface: return the caching strategy
   */
  strategy(): CacheStrategy {
    return this.cacheStrategy;
  }

  /**
   * Generate cache key with tenant prefix if multi-tenant
   */
  private generateKey(baseKey: string, tenant?: string | null): string {
    const tenantId = tenant !== undefined ? tenant : this.currentTenant;

    if (this.multiTenant && tenantId) {
      return `tenant:${tenantId}:${baseKey}`;
    }

    return baseKey;
  }

  /**
   * Drizzle Cache interface: get cached query result
   */
  async get(key: string): Promise<any[] | undefined> {
    const fullKey = this.generateKey(key);
    const result = await this.adapter.get(fullKey);

    if (result !== null) {
      console.log(`[DrizzleCache] Cache hit: ${fullKey}`);
      return result;
    }

    console.log(`[DrizzleCache] Cache miss: ${fullKey}`);
    return undefined;
  }

  /**
   * Drizzle Cache interface: store query result
   */
  async put(
    key: string,
    response: any,
    tables: string[],
    config?: CacheConfig
  ): Promise<void> {
    const ttl = config?.ex || this.defaultTTL;
    const fullKey = this.generateKey(key);

    const metadata = {
      tables,
      tags: [],
      tenant: this.multiTenant ? this.currentTenant : null,
    };

    await this.adapter.set(fullKey, response, ttl, metadata);
    console.log(`[DrizzleCache] Cached: ${fullKey} (TTL: ${ttl}s, Tables: ${tables.join(', ')})`);
  }

  /**
   * Drizzle Cache interface: invalidate cached queries
   */
  async onMutate(params: {
    tags?: string | string[];
    tables?: string | string[] | Table<any>[];
  }): Promise<void> {
    const { tags, tables } = params;
    const tenantId = this.multiTenant ? this.currentTenant : null;

    // Handle table invalidation
    if (tables) {
      const tableNames = Array.isArray(tables)
        ? tables.map(t => typeof t === 'string' ? t : (t as any).name || (t as any)._)
        : [typeof tables === 'string' ? tables : (tables as any).name || (tables as any)._];

      await this.adapter.invalidateByTables(tableNames, tenantId);
      console.log(`[DrizzleCache] Invalidated tables: ${tableNames.join(', ')}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
    }

    // Handle tag invalidation
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      await this.adapter.invalidateByTags(tagArray, tenantId);
      console.log(`[DrizzleCache] Invalidated tags: ${tagArray.join(', ')}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
    }
  }

  /**
   * Invalidate entire cache or by collection
   */
  async invalidateCollection(collection?: string | null, tenant?: string | null): Promise<void> {
    if (collection) {
      const tenantId = tenant !== undefined ? tenant : (this.multiTenant ? this.currentTenant : null);
      await this.adapter.invalidateByTables([collection], tenantId);
      console.log(`[DrizzleCache] Invalidated collection: ${collection}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
    } else {
      await this.adapter.clear();
      console.log('[DrizzleCache] Cleared entire cache');
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ keys: number; size?: number }> {
    return await this.adapter.getStats();
  }

  /**
   * Close cache adapter
   */
  async close(): Promise<void> {
    await this.adapter.close();
  }
}

// ============================================================================
// CACHE SERVICE FACTORY
// ============================================================================

let cacheInstance: BaasixDrizzleCache | null = null;

/**
 * Initialize the cache service based on environment configuration
 */
export async function initializeCacheService(): Promise<BaasixDrizzleCache | null> {
  const cacheEnabled = env.get('CACHE_ENABLED') === 'true';

  if (!cacheEnabled) {
    console.log('[CacheService] Cache is disabled');
    return null;
  }

  const cacheAdapter = env.get('CACHE_ADAPTER') || 'memory'; // 'memory', 'redis', 'upstash'
  const cacheStrategy = (env.get('CACHE_STRATEGY') || 'explicit') as CacheStrategy;
  const defaultTTL = parseInt(env.get('CACHE_TTL') || '3600', 10);
  const multiTenant = env.get('MULTI_TENANT') === 'true';

  let adapter: ICacheAdapter;

  try {
    switch (cacheAdapter.toLowerCase()) {
      case 'redis':
      case 'valkey': {
        const Redis = (await import('ioredis')).default;
        const redisUrl = env.get('CACHE_REDIS_URL');

        if (!redisUrl) {
          throw new Error('CACHE_REDIS_URL is required for Redis adapter');
        }

        const redisClient = new Redis(redisUrl);
        adapter = new RedisCacheAdapter(redisClient);
        console.log(`[CacheService] Initialized Redis/Valkey adapter`);
        break;
      }

      case 'upstash': {
        // @ts-ignore - Optional dependency
        const { Redis } = await import('@upstash/redis');
        const upstashUrl = env.get('UPSTASH_REDIS_REST_URL');
        const upstashToken = env.get('UPSTASH_REDIS_REST_TOKEN');

        if (!upstashUrl || !upstashToken) {
          throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for Upstash adapter');
        }

        const upstashClient = new Redis({
          url: upstashUrl,
          token: upstashToken,
        });

        adapter = new UpstashCacheAdapter(upstashClient);
        console.log('[CacheService] Initialized Upstash adapter');
        break;
      }

      case 'memory':
      default: {
        const maxSizeGB = parseFloat(env.get('CACHE_SIZE_GB') || '1');
        adapter = new InMemoryCacheAdapter(maxSizeGB);
        console.log(`[CacheService] Initialized InMemory adapter (${maxSizeGB}GB)`);
        break;
      }
    }

    cacheInstance = new BaasixDrizzleCache(adapter, {
      strategy: cacheStrategy,
      defaultTTL,
      multiTenant,
    });

    console.log(`[CacheService] Cache initialized - Strategy: ${cacheStrategy}, TTL: ${defaultTTL}s, Multi-tenant: ${multiTenant}`);

    return cacheInstance;
  } catch (error) {
    console.error('[CacheService] Failed to initialize cache:', error);

    // Fallback to in-memory cache
    const maxSizeGB = parseFloat(env.get('CACHE_SIZE_GB') || '1');
    adapter = new InMemoryCacheAdapter(maxSizeGB);

    cacheInstance = new BaasixDrizzleCache(adapter, {
      strategy: cacheStrategy,
      defaultTTL,
      multiTenant,
    });

    console.warn('[CacheService] Falling back to InMemory cache');
    return cacheInstance;
  }
}

/**
 * Get the cache instance
 */
export function getCacheService(): BaasixDrizzleCache | null {
  return cacheInstance;
}

/**
 * Close the cache service
 */
export async function closeCacheService(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.close();
    cacheInstance = null;
    console.log('[CacheService] Cache service closed');
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR BACKWARD COMPATIBILITY
// ============================================================================

/**
 * Invalidate entire cache or collection-specific cache
 * Compatible with old DBCache.invalidateEntireCache()
 */
export async function invalidateEntireCache(collection?: string | null): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.invalidateCollection(collection);
  }
}

/**
 * Invalidate by collection name
 */
export async function invalidateCollection(collection: string): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.invalidateCollection(collection);
  }
}
