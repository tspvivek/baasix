/**
 * Baasix Main Entry Point
 *
 * This is the main entry point for the Baasix framework with Drizzle ORM.
 * It exports all utilities, schemas, services, and routes.
 */

// Export server application and utilities
export { app, startServer, invalidateCorsCache, startServerForTesting, destroyAllTablesInDB } from './app.js';

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

// Export custom types
export * from './customTypes/index.js';

// Export plugins
export * from './plugins/softDelete.js';