/**
 * Hybrid L1/L2 Cache Implementation
 * 
 * Architecture:
 * - L1 (Memory): Fast reads, always local
 * - L2 (Redis): Source of truth for multi-instance sync
 * 
 * For hybrid keys (permissions, settings, auth):
 * - Reads: Always from L1 (memory) - fast, no network latency
 * - Writes: Write to both L1 and L2 (Redis)
 * - Sync: Periodic sync from L2 to L1 every X seconds
 * 
 * For non-hybrid keys:
 * - If Redis available: Use Redis directly
 * - If no Redis: Use in-memory only
 */

import Redis from "ioredis";
import env from "./env.js";

/**
 * Cache interface for both memory and Redis implementations
 */
export interface CacheInterface {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, expiresIn?: number): Promise<void>;
  delete(key: string): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
  invalidateModel(modelName: string): Promise<void>;
  tryLock(key: string, ttlSeconds?: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
  setIfNotExists(key: string, value: any, expiresIn?: number): Promise<boolean>;
  forceSync(): Promise<void>;
  isRedisEnabled(): boolean;
}

// Use globalThis to ensure singleton state across different module loading paths
declare global {
  var __baasix_cache: CacheInterface | null;
  var __baasix_redisClient: Redis | null;
  var __baasix_syncInterval: NodeJS.Timeout | null;
  var __baasix_isRedisEnabled: boolean;
  var __baasix_l1Cache: Map<string, { value: string; expiry: number }>;
  var __baasix_lastSyncedVersion: string | null;
}

// Initialize globals if not already set
globalThis.__baasix_cache = globalThis.__baasix_cache ?? null;
globalThis.__baasix_redisClient = globalThis.__baasix_redisClient ?? null;
globalThis.__baasix_syncInterval = globalThis.__baasix_syncInterval ?? null;
globalThis.__baasix_isRedisEnabled = globalThis.__baasix_isRedisEnabled ?? false;
globalThis.__baasix_l1Cache = globalThis.__baasix_l1Cache ?? new Map<string, { value: string; expiry: number }>();
globalThis.__baasix_lastSyncedVersion = globalThis.__baasix_lastSyncedVersion ?? null;

// Getters/setters for global state
const getGlobalCache = () => globalThis.__baasix_cache;
const setGlobalCache = (val: CacheInterface | null) => { globalThis.__baasix_cache = val; };
const getRedisClient = () => globalThis.__baasix_redisClient;
const setRedisClient = (val: Redis | null) => { globalThis.__baasix_redisClient = val; };
const getSyncInterval = () => globalThis.__baasix_syncInterval;
const setSyncInterval = (val: NodeJS.Timeout | null) => { globalThis.__baasix_syncInterval = val; };
const getIsRedisEnabled = () => globalThis.__baasix_isRedisEnabled;
const setIsRedisEnabled = (val: boolean) => { globalThis.__baasix_isRedisEnabled = val; };
const getL1Cache = () => globalThis.__baasix_l1Cache;
const getLastSyncedVersion = () => globalThis.__baasix_lastSyncedVersion;
const setLastSyncedVersion = (val: string | null) => { globalThis.__baasix_lastSyncedVersion = val; };

const CACHE_SIZE_GB = parseFloat(env.get("CACHE_SIZE_GB") || "1");
const CACHE_SIZE_BYTES = CACHE_SIZE_GB * 1024 * 1024 * 1024;
// Sync interval for L1 ← L2 synchronization (default: 5 seconds)
const CACHE_SYNC_INTERVAL_MS = (parseInt(env.get("CACHE_SYNC_INTERVAL") || "5")) * 1000;

/**
 * Keys that use hybrid L1+L2 caching
 * These are read from L1 (memory) and synced from L2 (Redis)
 */
const isHybridKey = (key: string): boolean => {
  return key.startsWith("permissions:") || 
         key.startsWith("settings:") || 
         key.startsWith("auth:");
};

/**
 * Keys that should never be evicted during cleanup
 */
const isProtectedKey = (key: string): boolean => {
  if (key === "baasix_tasks_not_started" || key === "baasix_task_running_state") {
    return true;
  }
  return isHybridKey(key);
};

/**
 * Sync hybrid keys from Redis (L2) to Memory (L1)
 * This runs periodically to keep L1 in sync with L2
 */
async function syncFromRedis(): Promise<void> {
  const redisClient = getRedisClient();
  const l1Cache = getL1Cache();
  
  if (!redisClient) return;
  
  try {
    // Get current version from Redis
    const currentVersion = await redisClient.get("cache:version");
    
    // Skip if version hasn't changed
    if (currentVersion === getLastSyncedVersion()) {
      return;
    }
    
    // Fetch all hybrid keys from Redis
    const hybridPatterns = ["permissions:*", "settings:*", "auth:*"];
    
    for (const pattern of hybridPatterns) {
      const keys = await redisClient.keys(pattern);
      
      for (const key of keys) {
        const value = await redisClient.get(key);
        if (value) {
          l1Cache.set(key, {
            value: value, // Already JSON string from Redis
            expiry: -1,   // Hybrid keys have infinite TTL
          });
        }
      }
    }
    
    setLastSyncedVersion(currentVersion);
    console.info(`[Cache Sync] L1 synchronized from L2 (version: ${currentVersion})`);
  } catch (error: any) {
    console.error("[Cache Sync] Error syncing from Redis:", error.message);
  }
}

/**
 * Increment the cache version in Redis to signal changes to other instances
 */
async function incrementCacheVersion(): Promise<void> {
  const redisClient = getRedisClient();
  if (!redisClient) return;
  
  try {
    await redisClient.incr("cache:version");
  } catch (error: any) {
    console.error("[Cache] Error incrementing version:", error.message);
  }
}

/**
 * Start periodic sync from Redis to Memory
 */
function startSyncInterval(): void {
  const redisClient = getRedisClient();
  if (getSyncInterval() || !redisClient) return;
  
  setSyncInterval(setInterval(async () => {
    await syncFromRedis();
  }, CACHE_SYNC_INTERVAL_MS));
  
  console.info(`[Cache] Started L1←L2 sync every ${CACHE_SYNC_INTERVAL_MS / 1000}s`);
}

/**
 * Stop periodic sync
 */
function stopSyncInterval(): void {
  const interval = getSyncInterval();
  if (interval) {
    clearInterval(interval);
    setSyncInterval(null);
  }
}

/**
 * Ensure cache size doesn't exceed limit
 */
async function ensureCacheSize(): Promise<void> {
  const redisClient = getRedisClient();
  const l1Cache = getL1Cache();
  let currentSize: number;
  
  if (redisClient) {
    const info = await redisClient.info("memory");
    const match = info.match(/used_memory:(\d+)/);
    currentSize = match ? parseInt(match[1]) : 0;
  } else {
    currentSize = 0;
    for (const [, entry] of l1Cache) {
      currentSize += entry.value.length;
    }
  }

  if (currentSize > CACHE_SIZE_BYTES) {
    const amountToFree = Math.ceil(CACHE_SIZE_BYTES * 0.2);
    let freedSize = 0;

    if (redisClient) {
      const allKeys = await redisClient.keys("*");
      const nonProtectedKeys = allKeys.filter((key) => !isProtectedKey(key));

      const keysWithTTL = await Promise.all(
        nonProtectedKeys.map(async (key) => ({
          key,
          ttl: await redisClient!.ttl(key),
        }))
      );

      const evictableKeys = keysWithTTL
        .filter(({ ttl }) => ttl !== -1)
        .sort((a, b) => a.ttl - b.ttl);

      for (const { key } of evictableKeys) {
        if (freedSize >= amountToFree) break;

        const size = await redisClient.strlen(key);
        await redisClient.del(key);
        freedSize += size;
      }

      if (freedSize > 0) {
        console.info(`Cache cleanup: Freed ${freedSize} bytes`);
      }
    } else {
      const sortedEntries = [...l1Cache.entries()]
        .filter(([key, value]) => !isProtectedKey(key) && value.expiry !== -1)
        .sort((a, b) => a[1].expiry - b[1].expiry);

      while (freedSize < amountToFree && sortedEntries.length > 0) {
        const [key, value] = sortedEntries.shift()!;
        const size = value.value.length;
        l1Cache.delete(key);
        freedSize += size;
      }

      if (freedSize > 0) {
        console.info(`In-memory cache cleanup: Freed ${freedSize} bytes`);
      }
    }
  }
}

/**
 * Initialize cache with hybrid L1/L2 support
 */
export function initializeCache(options: { ttl: number; uri?: string | null }): void {
  // Skip if already initialized
  if (getGlobalCache()) {
    return;
  }
  
  const defaultTTL = Math.floor(options.ttl / 1000); // Convert ms to seconds
  const uri = options.uri;
  
  // Check if we should use Redis based on CACHE_ADAPTER
  const cacheAdapter = env.get("CACHE_ADAPTER") || "memory";
  const shouldUseRedis = (cacheAdapter === "redis" || cacheAdapter === "upstash") && 
                         uri && uri.toLowerCase() !== "null" && uri !== "undefined" && uri !== "";
  
  if (shouldUseRedis) {
    setRedisClient(new Redis(uri!));
    setIsRedisEnabled(true);
    
    // Initial sync from Redis
    syncFromRedis().then(() => {
      console.info("[Cache] Initial L1←L2 sync completed");
    }).catch(err => {
      console.error("[Cache] Initial sync failed:", err.message);
    });
    
    // Start periodic sync
    startSyncInterval();
    
    console.info("[Cache] Hybrid L1(Memory)+L2(Redis) cache initialized");
  } else {
    setIsRedisEnabled(false);
    console.info("[Cache] In-memory only cache initialized");
  }
  
  const cacheImpl: CacheInterface = {
    /**
     * GET: For hybrid keys, always read from L1 (memory) for speed
     * For non-hybrid keys, read from Redis if available
     */
    get: async (key: string): Promise<any | null> => {
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      
      // Hybrid keys: Always read from L1 (memory)
      if (isHybridKey(key)) {
        const item = l1Cache.get(key);
        if (item) {
          if (item.expiry === -1 || item.expiry > Date.now()) {
            return JSON.parse(item.value);
          } else {
            l1Cache.delete(key);
          }
        }
        return null;
      }
      
      // Non-hybrid keys: Use Redis if available, else L1
      if (redisClient) {
        const value = await redisClient.get(key);
        return value ? JSON.parse(value) : null;
      } else {
        const item = l1Cache.get(key);
        if (item) {
          if (item.expiry === -1 || item.expiry > Date.now()) {
            return JSON.parse(item.value);
          } else {
            l1Cache.delete(key);
          }
        }
        return null;
      }
    },
    
    /**
     * SET: For hybrid keys, write to both L1 and L2
     * For non-hybrid keys, write to Redis if available
     */
    set: async (key: string, value: any, expiresIn: number = defaultTTL): Promise<void> => {
      await ensureCacheSize();
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      const jsonValue = JSON.stringify(value);
      
      // Hybrid keys: Write to both L1 and L2
      if (isHybridKey(key)) {
        // Write to L1
        l1Cache.set(key, {
          value: jsonValue,
          expiry: -1, // Hybrid keys always have infinite TTL in L1
        });
        
        // Write to L2 (Redis) if available
        if (redisClient) {
          await redisClient.set(key, jsonValue);
          await incrementCacheVersion();
        }
        return;
      }
      
      // Non-hybrid keys
      if (redisClient) {
        if (expiresIn === -1 || expiresIn === 0) {
          await redisClient.set(key, jsonValue);
        } else {
          await redisClient.set(key, jsonValue, "EX", expiresIn);
        }
      } else {
        const l1Cache = getL1Cache();
        const expiry = (expiresIn === -1 || expiresIn === 0) 
          ? -1 
          : Date.now() + expiresIn * 1000;
        l1Cache.set(key, { value: jsonValue, expiry });
      }
    },
    
    /**
     * DELETE: For hybrid keys, delete from both L1 and L2
     */
    delete: async (key: string): Promise<void> => {
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      
      // Always delete from L1
      l1Cache.delete(key);
      
      // Delete from L2 if Redis is available
      if (redisClient) {
        await redisClient.del(key);
        if (isHybridKey(key)) {
          await incrementCacheVersion();
        }
      }
    },
    
    /**
     * DEL: Alias for delete
     */
    del: async (key: string): Promise<void> => {
      await cacheImpl.delete(key);
    },
    
    /**
     * CLEAR: Clear all caches
     */
    clear: async (): Promise<void> => {
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      
      l1Cache.clear();
      if (redisClient) {
        await redisClient.flushdb();
        await incrementCacheVersion();
      }
      console.info("[Cache] All caches cleared");
    },
    
    /**
     * INVALIDATE MODEL: Delete all keys matching a pattern
     */
    invalidateModel: async (modelName: string): Promise<void> => {
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      
      // Clear from L1
      for (const key of l1Cache.keys()) {
        if (key.startsWith(`${modelName}:`)) {
          l1Cache.delete(key);
        }
      }
      
      // Clear from L2 (Redis)
      if (redisClient) {
        const keys = await redisClient.keys(`${modelName}:*`);
        if (keys.length > 0) {
          await redisClient.del(...keys);
          await incrementCacheVersion();
        }
      }
    },
    
    /**
     * TRY LOCK: Distributed lock (only works with Redis)
     */
    tryLock: async (key: string, ttlSeconds: number = 300): Promise<boolean> => {
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      
      if (redisClient) {
        const result = await redisClient.set(
          key,
          Date.now().toString(),
          'EX',
          ttlSeconds,
          'NX'
        );
        return result === 'OK';
      } else {
        // In-memory fallback (single instance only)
        const item = l1Cache.get(key);
        if (item && item.expiry > Date.now()) {
          return false;
        }
        l1Cache.set(key, {
          value: JSON.stringify(Date.now()),
          expiry: Date.now() + ttlSeconds * 1000,
        });
        console.warn("[Cache] In-memory lock acquired (single instance only)");
        return true;
      }
    },
    
    /**
     * UNLOCK: Release a lock
     */
    unlock: async (key: string): Promise<void> => {
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      
      if (redisClient) {
        await redisClient.del(key);
      } else {
        l1Cache.delete(key);
      }
    },
    
    /**
     * SET IF NOT EXISTS: Atomic set only if key doesn't exist
     */
    setIfNotExists: async (key: string, value: any, expiresIn: number = defaultTTL): Promise<boolean> => {
      const l1Cache = getL1Cache();
      const redisClient = getRedisClient();
      
      if (redisClient) {
        const result = await redisClient.set(
          key,
          JSON.stringify(value),
          'EX',
          expiresIn,
          'NX'
        );
        return result === 'OK';
      } else {
        const existing = l1Cache.get(key);
        if (existing && (existing.expiry === -1 || existing.expiry > Date.now())) {
          return false;
        }
        
        const expiry = (expiresIn === -1 || expiresIn === 0) 
          ? -1 
          : Date.now() + expiresIn * 1000;
        l1Cache.set(key, {
          value: JSON.stringify(value),
          expiry,
        });
        return true;
      }
    },
    
    /**
     * Force immediate sync from Redis to Memory
     */
    forceSync: async (): Promise<void> => {
      if (getRedisClient()) {
        await syncFromRedis();
      }
    },
    
    /**
     * Check if Redis is enabled
     */
    isRedisEnabled: (): boolean => getIsRedisEnabled(),
  };
  
  setGlobalCache(cacheImpl);
}

/**
 * Check if cache has been initialized
 */
export function isCacheInitialized(): boolean {
  return getGlobalCache() !== null;
}

/**
 * Get cache instance (singleton)
 */
export function getCache(): CacheInterface {
  const cache = getGlobalCache();
  if (!cache) {
    throw new Error("Cache has not been initialized. Call initializeCache first.");
  }
  return cache;
}

/**
 * Close cache connections
 */
export async function closeCache(): Promise<void> {
  stopSyncInterval();
  
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.quit();
    setRedisClient(null);
    console.info("[Cache] Redis connection closed");
  }
  
  getL1Cache().clear();
  setGlobalCache(null);
}
