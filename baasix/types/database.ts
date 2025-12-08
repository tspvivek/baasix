/**
 * Database and Transaction Types
 * Centralized database-related type definitions
 */

import type { TransactionClient } from '../utils/db.js';

/**
 * Transaction wrapper that mimics Sequelize's transaction API
 * Allows commit/rollback control like Sequelize
 */
// @ts-ignore - Complex Drizzle transaction type compatibility
export interface Transaction extends TransactionClient {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  _committed: boolean;
  _rolledBack: boolean;
}
