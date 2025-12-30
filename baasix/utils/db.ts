/**
 * Database Connection Layer for Drizzle ORM
 * Provides PostgreSQL connection with pooling, SSL support, and read replicas
 * Matches Sequelize database configuration for parity
 */

import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as fs from 'fs';
import argon2 from 'argon2';
import env from './env.js';
import { initializeCacheService, getCacheService, closeCacheService } from '../services/CacheService.js';
import type { Transaction as TransactionType } from '../types/database.js';

// Use globalThis to ensure singleton across different module loading paths
// (e.g., when loaded from both ./baasix/ and ./dist/ or npm package)
declare global {
  var __baasix_db: ReturnType<typeof drizzle> | null;
  var __baasix_sql: ReturnType<typeof postgres> | null;
  var __baasix_readSql: ReturnType<typeof postgres> | null;
}

// Initialize globals if not already set
globalThis.__baasix_db = globalThis.__baasix_db ?? null;
globalThis.__baasix_sql = globalThis.__baasix_sql ?? null;
globalThis.__baasix_readSql = globalThis.__baasix_readSql ?? null;

// Use getters to access the global instances
const getDbInstance = () => globalThis.__baasix_db;
const setDbInstance = (val: ReturnType<typeof drizzle> | null) => { globalThis.__baasix_db = val; };
const getSql = () => globalThis.__baasix_sql;
const setSql = (val: ReturnType<typeof postgres> | null) => { globalThis.__baasix_sql = val; };
const getReadSql = () => globalThis.__baasix_readSql;
const setReadSql = (val: ReturnType<typeof postgres> | null) => { globalThis.__baasix_readSql = val; };

const excludeModels = ['baasix_AuditLog', 'baasix_Sessions'];

// Type for drizzle instance
type DrizzleDb = ReturnType<typeof drizzle>;

// Type for transaction client (what tx is in db.transaction callback)
export type TransactionClient = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

// Re-export Transaction from types for backward compatibility
export type Transaction = TransactionType;

/**
 * Get database connection configuration
 */
function getConnectionConfig() {
  const config: postgres.Options<{}> = {
    max: parseInt(env.get('DATABASE_POOL_MAX') || '20'),
    idle_timeout: parseInt(env.get('DATABASE_POOL_IDLE') || '10000') / 1000, // Convert to seconds
    connect_timeout: parseInt(env.get('DATABASE_POOL_ACQUIRE') || '30000') / 1000, // Convert to seconds
    max_lifetime: parseInt(env.get('DATABASE_POOL_EVICT') || '1000') / 1000 * 60, // Convert to seconds
    onnotice: env.get('DATABASE_LOGGING') === 'true' ? console.log : undefined,
  };

  // SSL configuration
  if (env.get('DATABASE_SSL_CERTIFICATE') && env.get('DATABASE_SSL_CERTIFICATE') !== 'false') {
    const caCert = fs.readFileSync(env.get('DATABASE_SSL_CERTIFICATE')!);
    config.ssl = {
      ca: caCert.toString(),
      rejectUnauthorized: env.get('DATABASE_SSL_REJECT_UNAUTHORIZED') === 'true',
    };
    console.info('Using SSL certificate for database connection');
  }

  return config;
}

/**
 * Initialize database connection
 * Synchronous function that starts async cache initialization
 */
export function initializeDatabase() {
  if (getDbInstance()) {
    return getDbInstance();
  }

  const config = getConnectionConfig();

  // Start cache service initialization (async) but don't wait
  // The cache will be available for subsequent queries
  initializeCacheService().then(cacheService => {
    if (cacheService && getDbInstance()) {
      console.info('[Database] Cache service initialized and ready');
      // Note: Drizzle cache is set during drizzle() initialization below
      // We can't change it after creation, so cache is passed during init
    }
  }).catch(err => {
    console.error('[Database] Cache service initialization failed:', err);
  });

  // Check if read replicas are enabled
  if (env.get('DATABASE_READ_REPLICA_ENABLED') === 'true' && env.get('DATABASE_READ_REPLICA_URLS')) {
    const readReplicaUrls = env.get('DATABASE_READ_REPLICA_URLS')!.split(',').map(url => url.trim());

    // Write connection (primary)
    setSql(postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    }));

    // Read connections (replicas) - use first replica for now
    // In production, could implement load balancing across replicas
    const replicaConfig: postgres.Options<{}> = {
      max: parseInt(env.get('DATABASE_READ_REPLICA_POOL_MAX') || '20'),
      idle_timeout: parseInt(env.get('DATABASE_READ_REPLICA_POOL_IDLE') || '10000') / 1000,
      connect_timeout: parseInt(env.get('DATABASE_READ_REPLICA_POOL_ACQUIRE') || '30000') / 1000,
      max_lifetime: parseInt(env.get('DATABASE_READ_REPLICA_POOL_EVICT') || '1000') / 1000 * 60,
      onnotice: env.get('DATABASE_LOGGING') === 'true' ? console.log : undefined,
      debug: env.get('DATABASE_LOGGING') === 'true',
    };

    // Copy SSL config to replica if configured
    if (config.ssl) {
      replicaConfig.ssl = config.ssl;
    }

    setReadSql(postgres(readReplicaUrls[0], replicaConfig));

    setDbInstance(drizzle(getSql()!, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      // Cache will be initialized asynchronously and used on subsequent queries
    }));

    console.info(`Database initialized with read replicas: ${readReplicaUrls.length} replica(s) configured`);
  } else {
    // Single connection
    setSql(postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    }));

    setDbInstance(drizzle(getSql()!, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      // Cache will be initialized asynchronously and used on subsequent queries
    }));

    console.info('Database initialized without read replicas');
  }

  return getDbInstance()!;
}

/**
 * Initialize database with cache service (async version)
 * Use this when you need to ensure cache is ready before proceeding
 */
export async function initializeDatabaseWithCache() {
  if (getDbInstance()) {
    return getDbInstance();
  }

  const config = getConnectionConfig();

  // Initialize cache service first and wait for it
  const cacheService = await initializeCacheService();

  // Check if read replicas are enabled
  if (env.get('DATABASE_READ_REPLICA_ENABLED') === 'true' && env.get('DATABASE_READ_REPLICA_URLS')) {
    const readReplicaUrls = env.get('DATABASE_READ_REPLICA_URLS')!.split(',').map(url => url.trim());

    // Write connection (primary)
    setSql(postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    }));

    // Read connections (replicas)
    const replicaConfig: postgres.Options<{}> = {
      max: parseInt(env.get('DATABASE_READ_REPLICA_POOL_MAX') || '20'),
      idle_timeout: parseInt(env.get('DATABASE_READ_REPLICA_POOL_IDLE') || '10000') / 1000,
      connect_timeout: parseInt(env.get('DATABASE_READ_REPLICA_POOL_ACQUIRE') || '30000') / 1000,
      max_lifetime: parseInt(env.get('DATABASE_READ_REPLICA_POOL_EVICT') || '1000') / 1000 * 60,
      onnotice: env.get('DATABASE_LOGGING') === 'true' ? console.log : undefined,
      debug: env.get('DATABASE_LOGGING') === 'true',
    };

    if (config.ssl) {
      replicaConfig.ssl = config.ssl;
    }

    setReadSql(postgres(readReplicaUrls[0], replicaConfig));

    setDbInstance(drizzle(getSql()!, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      cache: cacheService || undefined,
    } as any));

    console.info(`Database initialized with read replicas and cache: ${readReplicaUrls.length} replica(s) configured`);
  } else {
    // Single connection
    setSql(postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    }));

    setDbInstance(drizzle(getSql()!, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      cache: cacheService || undefined,
    } as any));

    console.info('Database initialized with cache (no read replicas)');
  }

  return getDbInstance()!;
}

/**
 * Get database instance (synchronous - initializes if needed)
 */
export function getDatabase() {
  if (!getDbInstance()) {
    return initializeDatabase();
  }
  return getDbInstance()!;
}

// Export db as a getter to always return the current instance
// This ensures that even if the module is loaded from different paths,
// we always get the same database instance
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_, prop) {
    const instance = getDatabase();
    const value = (instance as any)[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

/**
 * Get postgres SQL client (for raw queries)
 */
export function getSqlClient() {
  if (!getSql()) {
    initializeDatabase();
  }
  return getSql()!;
}

// Export sql for backward compatibility
export const sqlClient = new Proxy({} as ReturnType<typeof postgres>, {
  get(_, prop) {
    const instance = getSqlClient();
    const value = (instance as any)[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  apply(_, thisArg, args) {
    return getSqlClient().apply(thisArg, args as any);
  },
}) as ReturnType<typeof postgres>;

/**
 * Get read replica SQL client (if configured)
 */
export function getReadSqlClient() {
  if (!getSql()) {
    initializeDatabase();
  }
  return getReadSql() || getSql()!;
}

/**
 * Close database connections
 */
export async function closeDatabase(): Promise<void> {
  // Close cache service first
  await closeCacheService();

  const sql = getSql();
  const readSql = getReadSql();
  
  if (sql) {
    await sql.end();
    setSql(null);
  }
  if (readSql) {
    await readSql.end();
    setReadSql(null);
  }
  setDbInstance(null);
  console.info('Database connections closed');
}

/**
 * Create a new transaction with Sequelize-compatible API
 * Returns a transaction that must be explicitly committed or rolled back
 *
 * Usage matching Sequelize:
 *   const transaction = await createTransaction();
 *   try {
 *     await transaction.insert(table).values(data);
 *     await transaction.commit();
 *   } catch (error) {
 *     await transaction.rollback();
 *     throw error;
 *   }
 */
export async function createTransaction(): Promise<Transaction> {
  let resolveTransaction: (value: any) => void;
  let rejectTransaction: (error: any) => void;
  let resolveTxComplete: () => void;
  let rejectTxComplete: (error: any) => void;

  // Transaction timeout (default 30 seconds, configurable via env)
  const TRANSACTION_TIMEOUT_MS = parseInt(env.get('TRANSACTION_TIMEOUT_MS') || '60000');

  const transactionPromise = new Promise((resolve, reject) => {
    resolveTransaction = resolve;
    rejectTransaction = reject;
  });

  // Promise that resolves when Drizzle's transaction completes
  const txCompletePromise = new Promise<void>((resolve, reject) => {
    resolveTxComplete = resolve;
    rejectTxComplete = reject;
  });

  // Start the Drizzle transaction
  const txPromise = db.transaction(async (tx) => {
    // Create wrapper with commit/rollback methods
    const transaction = tx as unknown as Transaction;
    transaction._committed = false;
    transaction._rolledBack = false;

    // Store the completion resolver
    (transaction as any)._resolveTxComplete = resolveTxComplete;
    (transaction as any)._rejectTxComplete = rejectTxComplete;

    transaction.commit = async () => {
      if (transaction._rolledBack) {
        throw new Error('Transaction already rolled back');
      }
      transaction._committed = true;
      // Wait for Drizzle transaction to complete before returning
      await txCompletePromise;
    };

    transaction.rollback = async () => {
      if (transaction._committed) {
        throw new Error('Transaction already committed');
      }
      transaction._rolledBack = true;
      throw new Error('__ROLLBACK__');
    };

    // Resolve with the transaction wrapper
    resolveTransaction(transaction);

    // Wait for explicit commit or rollback with timeout
    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      
      // Timeout to prevent transaction from hanging forever
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error(`[Transaction] Transaction timeout after ${TRANSACTION_TIMEOUT_MS}ms - forcing rollback`);
          transaction._rolledBack = true;
          resolve();
        }
      }, TRANSACTION_TIMEOUT_MS);

      const checkInterval = setInterval(() => {
        if (transaction._committed || transaction._rolledBack) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            clearInterval(checkInterval);
            resolve();
          }
        }
      }, 10);
    });

    // If rolled back, throw to trigger Drizzle's rollback
    if (transaction._rolledBack) {
      throw new Error('__ROLLBACK__');
    }

    // If committed, transaction will complete successfully here
  }).then(() => {
    // Transaction completed successfully
    resolveTxComplete();
  }).catch((error) => {
    // Swallow intentional rollback errors
    if (error.message === '__ROLLBACK__') {
      resolveTxComplete(); // Rollback is also a valid completion
    } else {
      rejectTxComplete(error);
      throw error;
    }
  });

  return transactionPromise as Promise<Transaction>;
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const sqlClient = getSqlClient();
    await sqlClient`SELECT 1 as test`;
    console.info('Database connection test successful');
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}

// Cache for PostgreSQL version
let pgVersionCache: { major: number; minor: number; full: string } | null = null;

/**
 * Get PostgreSQL server version
 * Returns { major: number, minor: number, full: string }
 * Caches the result after first call
 */
export async function getPostgresVersion(): Promise<{ major: number; minor: number; full: string }> {
  if (pgVersionCache) {
    return pgVersionCache;
  }

  try {
    const sqlClient = getSqlClient();
    const result = await sqlClient`SHOW server_version`;
    const versionString = result[0].server_version;
    
    // Parse version like "15.4" or "14.9 (Ubuntu 14.9-0ubuntu0.22.04.1)"
    const match = versionString.match(/^(\d+)\.(\d+)/);
    if (match) {
      pgVersionCache = {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        full: versionString,
      };
    } else {
      // Fallback if parsing fails
      pgVersionCache = { major: 14, minor: 0, full: versionString };
    }
    
    return pgVersionCache;
  } catch (error) {
    console.warn('Failed to get PostgreSQL version, defaulting to 14:', error);
    pgVersionCache = { major: 14, minor: 0, full: 'unknown' };
    return pgVersionCache;
  }
}

/**
 * Check if PostgreSQL version supports a feature
 * @param minMajor Minimum major version required
 * @param minMinor Minimum minor version required (default: 0)
 */
export async function isPgVersionAtLeast(minMajor: number, minMinor: number = 0): Promise<boolean> {
  const version = await getPostgresVersion();
  return version.major > minMajor || (version.major === minMajor && version.minor >= minMinor);
}

/**
 * Get helper to extract instance ID
 */
export function getInstanceId(instance: any): any {
  let id = instance.id || instance?._previousData?.id;
  if (instance.constructor?.name === 'baasix_SchemaDefinition') {
    return instance.collectionName;
  }
  return id;
}

export default {
  db,
  sql: sqlClient,
  initializeDatabase,
  initializeDatabaseWithCache,
  getDatabase,
  getSqlClient,
  getReadSqlClient,
  closeDatabase,
  createTransaction,
  testConnection,
  getInstanceId,
  getPostgresVersion,
  isPgVersionAtLeast,
};

// Export cache service for use in other modules
export { getCacheService, closeCacheService, initializeCacheService } from '../services/CacheService.js';
