/**
 * Baasix Utilities - Core utility functions and managers
 *
 * This module exports all utility functions and managers used throughout
 * the Baasix application with Drizzle ORM.
 */

/**
 * Baasix Utilities Index
 *
 * Centralized exports for all utility modules
 */

// ============================================================================
// TYPE EXPORTS FROM CENTRALIZED TYPES FOLDER
// ============================================================================
// Note: Individual utility files re-export their types from ../types for backward compatibility
// For direct type imports, prefer importing from '@/types' or '../types'

// Database connection utilities
export {
  initializeDatabase,
  getDatabase,
  getSqlClient,
  testConnection,
  closeDatabase
} from './db.js';

// Environment utilities
export { default as env } from './env.js';

// Type mapping utilities
export { mapJsonTypeToDrizzle } from './typeMapper.js';
export { default as typeMapper } from './typeMapper.js';

// Schema management utilities
export { schemaManager } from './schemaManager.js';

// Relation utilities
export { relationBuilder, RelationBuilder } from './relationUtils.js';

// System schemas
export { systemSchemas } from './systemschema.js';

// Query building utilities
export * from './filterOperators.js';
export * from './queryBuilder.js';
export * from './orderUtils.js';
// @ts-expect-error - applyFullTextSearch is exported from both queryBuilder and aggregationUtils with different signatures
export * from './aggregationUtils.js';
export * from './relationLoader.js';

// ============================================================================
// NEW UTILITIES FOR 100% SEQUELIZE PARITY
// ============================================================================

// Spatial/Geospatial Utilities (HIGH PRIORITY - PostGIS support)
export { default as spatialUtils } from './spatialUtils.js';

// Field Utilities (HIGH PRIORITY - field operations & validation)
export { default as fieldUtils } from './fieldUtils.js';

// Import/Export Utilities (HIGH PRIORITY - CSV/JSON bulk operations)
export { default as importUtils } from './importUtils.js';

// Schema Validation (HIGH PRIORITY - comprehensive schema validation)
export { default as schemaValidator } from './schemaValidator.js';

// Cache Service (Drizzle native caching with multiple adapters)
export {
  initializeCacheService,
  getCacheService,
  closeCacheService,
  invalidateCollection,
  invalidateEntireCache,
  BaasixDrizzleCache,
  InMemoryCacheAdapter,
  RedisCacheAdapter,
  UpstashCacheAdapter,
} from '../services/CacheService.js';

// Seeding Utilities (LOW PRIORITY - database seeding)
export { default as seedUtility } from './seed.js';
export {
  seedCollection,
  seedMultiple,
  generateTemplate,
  printSummary,
} from './seed.js';

// Workflow Utilities (HIGH PRIORITY - workflow role-based access control)
export {
  checkWorkflowRoleAccess,
  fetchWorkflowForExecution,
  validateWorkflowAccess,
  fetchAndValidateWorkflow,
  canSetWorkflowRoles,
} from './workflow.js';

// Sort Utilities
export {
  sortItems,
  reorderItems,
  getNextSortValue,
} from './sortUtils.js';
export type { SortOptions, SortResult } from './sortUtils.js';

// Error handling utilities
export { APIError, errorHandler } from './errorHandler.js';

// Logger utilities
export { initializeLogger, getLogger, getOriginalConsole } from './logger.js';
export type { BaasixLoggerOptions, Logger, LoggerOptions, DestinationStream } from './logger.js';

// Common utilities (shared across routes)
export {
  modelExistsMiddleware,
  requireAuth,
  getImportAccountability,
  collectionHasTenantField,
  invalidateAuthCache,
  invalidateCollectionCache,
  invalidateSettingsCache,
  invalidateSettingsCacheAfterImport,
} from './common.js';

/**
 * USAGE EXAMPLES
 * ==============
 * 
 * 1. SPATIAL OPERATIONS:
 *    import { spatialUtils } from '@/utils';
 *    const point = spatialUtils.pointToGeometry(-122.4194, 37.7749);
 *    const nearby = spatialUtils.dwithin('location', point, 1000, true);
 * 
 * 2. FIELD UTILITIES:
 *    import { fieldUtils } from '@/utils';
 *    const fields = fieldUtils.getFlattenedFields('users');
 *    const validation = fieldUtils.validateRequiredFields('users', data);
 * 
 * 3. IMPORT/EXPORT:
 *    import { importUtils } from '@/utils';
 *    const data = importUtils.parseCSV(fileBuffer);
 *    const csv = importUtils.exportToCSV(users, ['id', 'email']);
 * 
 * 4. SCHEMA VALIDATION:
 *    import { schemaValidator } from '@/utils';
 *    const result = schemaValidator.validateSchemaBeforeCreate('users', schema);
 * 
 * 5. CACHED OPERATIONS:
 *    import { dbCache } from '@/utils';
 *    const users = await dbCache.findAll_Cached('users', { limit: 10 });
 * 
 * 6. DATABASE SEEDING:
 *    import { seedUtility } from '@/utils';
 *    await seedUtility.seedCollection({ collection: 'users', data: [...] });
 * 
 * 7. WORKFLOW ACCESS CONTROL:
 *    import { checkWorkflowRoleAccess, fetchWorkflowForExecution } from '@/utils';
 *    const workflow = await fetchWorkflowForExecution(workflowId, true);
 *    const hasAccess = checkWorkflowRoleAccess(workflow, req.accountability);
 */

