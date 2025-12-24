/**
 * Baasix Main Entry Point
 *
 * This is the main entry point for the Baasix framework with Drizzle ORM.
 * It exports all utilities, schemas, services, and routes.
 */

// Export server application and utilities
export { app, startServer, invalidateCorsCache, startServerForTesting, destroyAllTablesInDB } from './app.js';
export type { StartServerOptions } from './app.js';

// Export logger utilities
export { initializeLogger, getLogger, getOriginalConsole } from './utils/logger.js';
export type { BaasixLoggerOptions, Logger, LoggerOptions, DestinationStream } from './utils/logger.js';

// Export all utilities
export * from './utils/index.js';

// Export services (for use in extensions)
export { default as ItemsService } from './services/ItemsService.js';
export { default as FilesService } from './services/FilesService.js';
export { default as MailService } from './services/MailService.js';
export { default as NotificationService } from './services/NotificationService.js';
export { default as PermissionService } from './services/PermissionService.js';
export { default as SettingsService } from './services/SettingsService.js';
export { default as StorageService } from './services/StorageService.js';
export { default as AssetsService } from './services/AssetsService.js';
export { default as HooksManager } from './services/HooksManager.js';
export { default as ReportService } from './services/ReportService.js';
export { default as SocketService } from './services/SocketService.js';
export { default as StatsService } from './services/StatsService.js';
export { default as TasksService } from './services/TasksService.js';
export { default as WorkflowService } from './services/WorkflowService.js';
export { 
  BaasixDrizzleCache,
  getCacheService,
  initializeCacheService,
  closeCacheService,
  invalidateEntireCache,
  invalidateCollection,
  InMemoryCacheAdapter,
  RedisCacheAdapter,
  UpstashCacheAdapter,
} from './services/CacheService.js';

// Export auth module
export * from './auth/index.js';

// Export custom types
export * from './customTypes/index.js';

// Export plugins
export * from './plugins/softDelete.js';