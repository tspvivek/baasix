import fs from 'fs';
import path from 'path';
import { db, getDatabase } from '../utils/db.js';
import { sql } from 'drizzle-orm';
import { schemaManager } from '../utils/schemaManager.js';
import type { HookContext, HookFunction } from '../types/index.js';
import { getProjectPath, toFileURL } from '../utils/dirname.js';

// Re-export types for backward compatibility
export type { HookContext, HookFunction };

/**
 * Hooks Manager - Executes lifecycle hooks for collections
 *
 * Matches Sequelize implementation 1:1
 */

export class HooksManager {
  private hooks: Record<string, HookFunction[]> = {};

  /**
   * Register a hook for a collection and event
   */
  registerHook(
    collection: string,
    event: string,
    hookFunction: HookFunction
  ): void {
    const key = `${collection}:${event}`;
    console.info(`Registering hook for ${key}`);
    
    if (!this.hooks[key]) {
      this.hooks[key] = [];
    }
    
    this.hooks[key].push(hookFunction);
  }

  /**
   * Get hooks for a collection and event
   * Returns both specific hooks and wildcard hooks (registered for all collections)
   */
  getHooks(collection: string, event: string): HookFunction[] {
    // Get hooks for specific collection
    const specificHooks = this.hooks[`${collection}:${event}`] || [];
    
    // Get wildcard hooks (registered for all collections with *)
    const wildcardHooks = this.hooks[`*:${event}`] || [];
    
    // Combine both - wildcard hooks execute first
    return [...wildcardHooks, ...specificHooks];
  }

  /**
   * Execute hooks for a collection and action
   */
  async executeHooks(
    collection: string,
    event: string,
    accountability: any,
    context: HookContext
  ): Promise<HookContext> {
    const hooks = this.getHooks(collection, event);
    let modifiedData = { ...context };

    // Execute each hook in sequence
    for (const hook of hooks) {
      const result = await hook({
        collection,
        accountability,
        db,
        ...modifiedData,
      });
      
      // Update modifiedData with hook result if provided
      if (result) {
        modifiedData = result;
      }
    }

    return modifiedData;
  }

  /**
   * Load hooks from extensions directory
   */
  async loadHooksFromDirectory(context: any, directory?: string): Promise<void> {
    if (!directory) {
      directory = getProjectPath('extensions');
    }

    if (!fs.existsSync(directory)) {
      console.warn(`Hooks directory not found: ${directory}`);
      return;
    }

    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);

      if (fs.statSync(filePath).isDirectory() && file.startsWith('baasix-hook-')) {
        const hookFile = path.join(filePath, 'index.js');

        if (fs.existsSync(hookFile)) {
          try {
            // Dynamic import for ES modules
            // Convert to file:// URL for Windows compatibility
            const hookModule = await import(toFileURL(hookFile));

            if (typeof hookModule.default === 'function') {
              await hookModule.default(this, context);
              console.info(`Loaded hook: ${file}`);
            }
          } catch (error) {
            console.error(`Failed to load hook ${file}:`, error);
          }
        }
      }
    }
  }

  /**
   * Load schedules from extensions directory
   */
  async loadSchedulesFromDirectory(context: any, schedule: any, directory?: string): Promise<void> {
    if (!directory) {
      directory = getProjectPath('extensions');
    }

    if (!fs.existsSync(directory)) {
      console.warn(`Schedules directory not found: ${directory}`);
      return;
    }

    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);

      if (fs.statSync(filePath).isDirectory() && file.startsWith('baasix-schedule-')) {
        const scheduleFile = path.join(filePath, 'index.js');

        if (fs.existsSync(scheduleFile)) {
          try {
            // Dynamic import for ES modules
            // Convert to file:// URL for Windows compatibility
            const scheduleModule = await import(toFileURL(scheduleFile));

            if (typeof scheduleModule.default === 'function') {
              await scheduleModule.default(schedule, context);
              console.info(`Loaded schedule: ${file}`);
            }
          } catch (error) {
            console.error(`Failed to load schedule ${file}:`, error);
          }
        }
      }
    }
  }
}

// Export singleton instance
// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_hooksManager: HooksManager | undefined;
  var __baasix_hooksManagerInitialized: boolean | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_hooksManager) {
  globalThis.__baasix_hooksManager = new HooksManager();
}

export const hooksManager = globalThis.__baasix_hooksManager;

// Register global beforeCreate hook for auto-sort functionality (only once)
if (!globalThis.__baasix_hooksManagerInitialized) {
  globalThis.__baasix_hooksManagerInitialized = true;
  hooksManager.registerHook('*', 'items.create', async (context: HookContext) => {
    const { data, collection } = context;

    if (!data) {
      return context;
    }

    try {
      // Get the Drizzle table schema (using statically imported schemaManager)
      const table = schemaManager.getTable(collection);

      // Check if table has a 'sort' column by trying to access it
      if (table && table.sort) {
        // If sort is not provided or is null/undefined, auto-increment it
        if (data.sort === undefined || data.sort === null) {
          const db = getDatabase();

          // Query for max sort value
          const result = await db.execute(sql`
            SELECT COALESCE(MAX("sort"), 0) as max_sort
            FROM "${sql.raw(collection)}"
          `);

          const maxSort = result[0]?.max_sort || 0;
          data.sort = Number(maxSort) + 1;
          console.log(`[HooksManager] Auto-assigned sort value ${data.sort} for ${collection}`);
        }
      }
    } catch (error: any) {
      // If query fails, silently ignore (sort field might not exist)
      console.warn(`Failed to auto-increment sort for ${collection}:`, error.message);
    }

    return context;
  });
}

export default hooksManager;

