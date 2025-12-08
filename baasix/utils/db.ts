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

let dbInstance: ReturnType<typeof drizzle> | null = null;
let sql: ReturnType<typeof postgres> | null = null;
let readSql: ReturnType<typeof postgres> | null = null;

const excludeModels = ['baasix_AuditLog', 'baasix_Sessions'];

// Type for transaction client (what tx is in db.transaction callback)
export type TransactionClient = Parameters<Parameters<typeof dbInstance.transaction>[0]>[0];

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
  if (dbInstance) {
    console.log('Database already initialized');
    return dbInstance;
  }

  const config = getConnectionConfig();

  // Start cache service initialization (async) but don't wait
  // The cache will be available for subsequent queries
  initializeCacheService().then(cacheService => {
    if (cacheService && dbInstance) {
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
    sql = postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    });

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

    readSql = postgres(readReplicaUrls[0], replicaConfig);

    dbInstance = drizzle(sql, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      // Cache will be initialized asynchronously and used on subsequent queries
    });

    console.info(`Database initialized with read replicas: ${readReplicaUrls.length} replica(s) configured`);
  } else {
    // Single connection
    sql = postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    });

    dbInstance = drizzle(sql, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      // Cache will be initialized asynchronously and used on subsequent queries
    });

    console.info('Database initialized without read replicas');
  }

  return dbInstance;
}

/**
 * Initialize database with cache service (async version)
 * Use this when you need to ensure cache is ready before proceeding
 */
export async function initializeDatabaseWithCache() {
  if (dbInstance) {
    console.log('Database already initialized');
    return dbInstance;
  }

  const config = getConnectionConfig();

  // Initialize cache service first and wait for it
  const cacheService = await initializeCacheService();

  // Check if read replicas are enabled
  if (env.get('DATABASE_READ_REPLICA_ENABLED') === 'true' && env.get('DATABASE_READ_REPLICA_URLS')) {
    const readReplicaUrls = env.get('DATABASE_READ_REPLICA_URLS')!.split(',').map(url => url.trim());

    // Write connection (primary)
    sql = postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    });

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

    readSql = postgres(readReplicaUrls[0], replicaConfig);

    dbInstance = drizzle(sql, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      cache: cacheService || undefined,
    } as any);

    console.info(`Database initialized with read replicas and cache: ${readReplicaUrls.length} replica(s) configured`);
  } else {
    // Single connection
    sql = postgres(env.get('DATABASE_URL')!, {
      ...config,
      debug: env.get('DATABASE_LOGGING') === 'true',
    });

    dbInstance = drizzle(sql, {
      logger: env.get('DATABASE_LOGGING') === 'true',
      cache: cacheService || undefined,
    } as any);

    console.info('Database initialized with cache (no read replicas)');
  }

  return dbInstance;
}

/**
 * Get database instance (synchronous - initializes if needed)
 */
export function getDatabase() {
  if (!dbInstance) {
    return initializeDatabase();
  }
  return dbInstance;
}

// Export db as the main database instance (lazy initialization)
export const db = getDatabase();

/**
 * Get postgres SQL client (for raw queries)
 */
export function getSqlClient() {
  if (!sql) {
    initializeDatabase();
  }
  return sql!;
}

// Export sql for backward compatibility
export const sqlClient = getSqlClient();

/**
 * Get read replica SQL client (if configured)
 */
export function getReadSqlClient() {
  if (!sql) {
    initializeDatabase();
  }
  return readSql || sql!;
}

/**
 * Close database connections
 */
export async function closeDatabase(): Promise<void> {
  // Close cache service first
  await closeCacheService();

  if (sql) {
    await sql.end();
    sql = null;
  }
  if (readSql) {
    await readSql.end();
    readSql = null;
  }
  dbInstance = null;
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

    // Wait for explicit commit or rollback
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (transaction._committed || transaction._rolledBack) {
          clearInterval(checkInterval);
          resolve();
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
};

// Export cache service for use in other modules
export { getCacheService, closeCacheService, initializeCacheService } from '../services/CacheService.js';
