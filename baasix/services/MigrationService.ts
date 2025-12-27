import { getDatabase, getSqlClient } from "../utils/db.js";
import { schemaManager } from "../utils/schemaManager.js";
import { eq, desc, and, sql } from "drizzle-orm";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import env from "../utils/env.js";
import { getBaasixPath, getProjectPath } from "../utils/dirname.js";

/**
 * Migration status enum
 */
export type MigrationStatus = "pending" | "running" | "completed" | "failed" | "rolled_back";

/**
 * Migration type enum
 */
export type MigrationType = "system" | "schema" | "data" | "custom";

/**
 * Migration record interface
 */
export interface MigrationRecord {
  id?: string;
  version: string;
  name: string;
  description?: string;
  type: MigrationType;
  status: MigrationStatus;
  batch?: number;
  executedAt?: Date;
  executionTimeMs?: number;
  errorMessage?: string;
  errorStack?: string;
  metadata?: Record<string, any>;
  checksum?: string;
  canRollback?: boolean;
  rolledBackAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Migration script interface
 */
export interface MigrationScript {
  version: string;
  name: string;
  description?: string;
  type?: MigrationType;
  canRollback?: boolean;
  /**
   * The up function to run the migration
   */
  up: (context: MigrationContext) => Promise<MigrationResult>;
  /**
   * The down function to rollback the migration (optional)
   */
  down?: (context: MigrationContext) => Promise<MigrationResult>;
}

/**
 * Migration context passed to migration scripts
 */
export interface MigrationContext {
  db: ReturnType<typeof getDatabase>;
  sql: ReturnType<typeof getSqlClient>;
  schemaManager: typeof schemaManager;
  env: typeof env;
  log: (message: string) => void;
}

/**
 * Migration result from a script execution
 */
export interface MigrationResult {
  success: boolean;
  message?: string;
  metadata?: Record<string, any>;
}

/**
 * Migration run options
 */
export interface MigrationRunOptions {
  /** Run only specific migration version */
  version?: string;
  /** Run migrations up to and including this version */
  toVersion?: string;
  /** Number of migrations to run */
  step?: number;
  /** Only run pending migrations */
  pendingOnly?: boolean;
  /** Dry run - don't actually execute migrations */
  dryRun?: boolean;
}

/**
 * MigrationService - Handles database migration execution and tracking
 */
class MigrationService {
  private initialized: boolean = false;
  private migrationsDir: string = "";
  private systemMigrationsDir: string = "";
  private logs: string[] = [];
  private isUpgradeFromSequelize: boolean = false;

  constructor() {
    // User migrations directory - in user's project
    this.migrationsDir = env.get("MIGRATIONS_DIR") || getProjectPath("migrations");
    // System migrations directory - bundled with package
    this.systemMigrationsDir = getBaasixPath("migrations");
  }

  /**
   * Detect if this is an upgrade from Sequelize version
   * MUST be called BEFORE schemaManager.initialize() because that creates the migration table
   * 
   * Detection logic:
   * - If baasix_User exists but baasix_Migration does NOT exist → Sequelize upgrade
   * - If neither exists → Fresh installation
   * - If both exist → Already on Drizzle version
   */
  async detectUpgradeBeforeSchemaInit(): Promise<boolean> {
    const sqlClient = getSqlClient();

    try {
      // Check if baasix_Migration table exists (new in Drizzle version)
      const migrationTableExists = await sqlClient`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'baasix_Migration'
        )
      `;

      if (migrationTableExists[0]?.exists) {
        // Migration table exists - this is already running Drizzle version
        console.info("MigrationService: baasix_Migration table found - already on Drizzle version");
        this.isUpgradeFromSequelize = false;
        return false;
      }

      // Migration table doesn't exist - check if this is an existing Sequelize database
      // by looking for baasix_User table (present in both versions)
      const userTableExists = await sqlClient`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'baasix_User'
        )
      `;

      if (!userTableExists[0]?.exists) {
        // No user table either - this is a fresh installation
        console.info("MigrationService: Fresh installation detected (no existing tables)");
        this.isUpgradeFromSequelize = false;
        return false;
      }

      // User table exists but Migration table doesn't - SEQUELIZE UPGRADE!
      console.info("MigrationService: ⚠️  SEQUELIZE TO DRIZZLE UPGRADE DETECTED!");
      console.info("MigrationService: Found baasix_User table but no baasix_Migration table");
      this.isUpgradeFromSequelize = true;
      return true;

    } catch (error) {
      console.warn("MigrationService: Error during upgrade detection:", error);
      this.isUpgradeFromSequelize = false;
      return false;
    }
  }

  /**
   * Initialize the migration service
   * @param isUpgradeFromSequelize - Pass true if detectUpgradeBeforeSchemaInit() returned true
   */
  async init(isUpgradeFromSequelize?: boolean): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.info("MigrationService: Initializing...");

    // Use passed value or previously detected value
    if (isUpgradeFromSequelize !== undefined) {
      this.isUpgradeFromSequelize = isUpgradeFromSequelize;
    }

    // Ensure migrations table exists (handled by schemaManager)
    // Just verify we can access it
    try {
      const table = schemaManager.getTable("baasix_Migration");
      if (!table) {
        console.warn("MigrationService: baasix_Migration table not found, will be created on first use");
      }
    } catch (error) {
      console.warn("MigrationService: Could not access migration table:", error);
    }

    // Ensure migrations directories exist
    await this.ensureMigrationDirs();

    this.initialized = true;
    console.info("MigrationService: Initialized successfully");
  }

  /**
   * Check if this instance is an upgrade from Sequelize
   */
  isSequelizeUpgrade(): boolean {
    return this.isUpgradeFromSequelize;
  }

  /**
   * Ensure migration directories exist
   */
  private async ensureMigrationDirs(): Promise<void> {
    try {
      await fs.mkdir(this.migrationsDir, { recursive: true });
    } catch {
      // Ignore if directory already exists
    }

    try {
      await fs.mkdir(this.systemMigrationsDir, { recursive: true });
    } catch {
      // Ignore if directory already exists
    }
  }

  /**
   * Get all recorded migrations from database
   */
  async getMigrations(options?: { status?: MigrationStatus; type?: MigrationType }): Promise<MigrationRecord[]> {
    const db = getDatabase();
    const table = schemaManager.getTable("baasix_Migration");

    if (!table) {
      return [];
    }

    const conditions: any[] = [];
    if (options?.status) {
      conditions.push(eq(table.status, options.status));
    }
    if (options?.type) {
      conditions.push(eq(table.type, options.type));
    }

    let results;
    if (conditions.length > 0) {
      results = await db.select().from(table).where(and(...conditions)).orderBy(desc(table.executedAt));
    } else {
      results = await db.select().from(table).orderBy(desc(table.executedAt));
    }

    return results as MigrationRecord[];
  }

  /**
   * Get the last executed migration
   */
  async getLastMigration(): Promise<MigrationRecord | null> {
    const db = getDatabase();
    const table = schemaManager.getTable("baasix_Migration");

    if (!table) {
      return null;
    }

    const results = await db
      .select()
      .from(table)
      .where(eq(table.status, "completed"))
      .orderBy(desc(table.executedAt))
      .limit(1);

    return results[0] as MigrationRecord || null;
  }

  /**
   * Get migration by version
   */
  async getMigrationByVersion(version: string): Promise<MigrationRecord | null> {
    const db = getDatabase();
    const table = schemaManager.getTable("baasix_Migration");

    if (!table) {
      return null;
    }

    const results = await db
      .select()
      .from(table)
      .where(eq(table.version, version))
      .limit(1);

    return results[0] as MigrationRecord || null;
  }

  /**
   * Get pending migrations (scripts that haven't been executed)
   */
  async getPendingMigrations(): Promise<MigrationScript[]> {
    // Get all executed migration versions
    const executedMigrations = await this.getMigrations({ status: "completed" });
    const executedVersions = new Set(executedMigrations.map(m => m.version));

    // Get all migration scripts
    const allScripts = await this.loadMigrationScripts();

    // Filter to only pending ones
    return allScripts.filter(script => !executedVersions.has(script.version));
  }

  /**
   * Load migration scripts from directory
   */
  async loadMigrationScripts(directory?: string): Promise<MigrationScript[]> {
    const scripts: MigrationScript[] = [];

    // Load system migrations first
    const systemScripts = await this.loadScriptsFromDir(this.systemMigrationsDir);
    scripts.push(...systemScripts);

    // Load user migrations
    const userScripts = await this.loadScriptsFromDir(directory || this.migrationsDir);
    scripts.push(...userScripts);

    // Sort by version (semantic versioning or timestamp-based)
    scripts.sort((a, b) => this.compareVersions(a.version, b.version));

    return scripts;
  }

  /**
   * Load scripts from a specific directory
   */
  private async loadScriptsFromDir(dir: string): Promise<MigrationScript[]> {
    const scripts: MigrationScript[] = [];

    try {
      const files = await fs.readdir(dir);
      const migrationFiles = files.filter(f => 
        (f.endsWith(".js") || f.endsWith(".ts")) && 
        !f.endsWith(".d.ts") &&
        !f.startsWith("_")
      );

      for (const file of migrationFiles) {
        try {
          const filePath = path.join(dir, file);
          const module = await import(filePath);
          
          // Support both default export and named export
          const migration = module.default || module.migration || module;

          if (migration && typeof migration.up === "function" && migration.version) {
            scripts.push({
              version: migration.version,
              name: migration.name || file.replace(/\.(js|ts)$/, ""),
              description: migration.description,
              type: migration.type || "custom",
              canRollback: typeof migration.down === "function",
              up: migration.up,
              down: migration.down,
            });
          } else {
            console.warn(`MigrationService: Invalid migration file ${file} - missing version or up function`);
          }
        } catch (error) {
          console.error(`MigrationService: Error loading migration ${file}:`, error);
        }
      }
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        console.error(`MigrationService: Error reading migrations directory ${dir}:`, error);
      }
    }

    return scripts;
  }

  /**
   * Compare two version strings
   * Supports semver (1.0.0, 1.0.0-alpha.1) and timestamp (20240101_001) formats
   */
  private compareVersions(a: string, b: string): number {
    // Check if both are semver-like
    const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;
    const matchA = a.match(semverRegex);
    const matchB = b.match(semverRegex);

    if (matchA && matchB) {
      // Compare major.minor.patch
      for (let i = 1; i <= 3; i++) {
        const diff = parseInt(matchA[i]) - parseInt(matchB[i]);
        if (diff !== 0) return diff;
      }
      // Compare prerelease
      if (matchA[4] && matchB[4]) {
        return matchA[4].localeCompare(matchB[4]);
      }
      if (matchA[4]) return -1; // a has prerelease, b doesn't
      if (matchB[4]) return 1;  // b has prerelease, a doesn't
      return 0;
    }

    // Fallback to string comparison
    return a.localeCompare(b);
  }

  /**
   * Calculate checksum for a migration script
   */
  private async calculateChecksum(script: MigrationScript): Promise<string> {
    const content = script.up.toString() + (script.down?.toString() || "");
    return crypto.createHash("md5").update(content).digest("hex");
  }

  /**
   * Run pending migrations
   */
  async runPendingMigrations(options?: MigrationRunOptions): Promise<MigrationRecord[]> {
    await this.init();

    const pendingScripts = await this.getPendingMigrations();
    
    if (pendingScripts.length === 0) {
      console.info("MigrationService: No pending migrations to run");
      return [];
    }

    console.info(`MigrationService: Found ${pendingScripts.length} pending migration(s)`);

    let scriptsToRun = pendingScripts;

    // Apply options
    if (options?.version) {
      scriptsToRun = scriptsToRun.filter(s => s.version === options.version);
    } else if (options?.toVersion) {
      scriptsToRun = scriptsToRun.filter(s => 
        this.compareVersions(s.version, options.toVersion!) <= 0
      );
    }

    if (options?.step && options.step > 0) {
      scriptsToRun = scriptsToRun.slice(0, options.step);
    }

    if (scriptsToRun.length === 0) {
      console.info("MigrationService: No migrations match the specified criteria");
      return [];
    }

    // Get next batch number
    const batch = await this.getNextBatchNumber();

    const results: MigrationRecord[] = [];

    for (const script of scriptsToRun) {
      const result = await this.runMigration(script, batch, options?.dryRun);
      results.push(result);

      // Stop on failure
      if (result.status === "failed") {
        console.error(`MigrationService: Migration ${script.version} failed, stopping`);
        break;
      }
    }

    return results;
  }

  /**
   * Run a single migration
   */
  async runMigration(
    script: MigrationScript, 
    batch?: number, 
    dryRun: boolean = false
  ): Promise<MigrationRecord> {
    const db = getDatabase();
    const sqlClient = getSqlClient();
    const table = schemaManager.getTable("baasix_Migration");

    this.logs = [];
    const log = (message: string) => {
      this.logs.push(`[${new Date().toISOString()}] ${message}`);
      console.info(`MigrationService: ${message}`);
    };

    log(`Running migration: ${script.version} - ${script.name}`);

    if (dryRun) {
      log("DRY RUN - Migration will not be executed");
      return {
        version: script.version,
        name: script.name,
        description: script.description,
        type: script.type || "custom",
        status: "pending",
        metadata: { dryRun: true },
      };
    }

    const checksum = await this.calculateChecksum(script);
    const startTime = Date.now();

    // Create migration record with running status
    const migrationRecord: Partial<MigrationRecord> = {
      version: script.version,
      name: script.name,
      description: script.description,
      type: script.type || "custom",
      status: "running",
      batch: batch || await this.getNextBatchNumber(),
      checksum,
      canRollback: !!script.down,
      metadata: { logs: [] },
    };

    // Insert the record
    if (table) {
      await db.insert(table).values(migrationRecord as any);
    }

    try {
      // Execute the migration
      const context: MigrationContext = {
        db,
        sql: sqlClient,
        schemaManager,
        env,
        log,
      };

      const result = await script.up(context);

      const executionTimeMs = Date.now() - startTime;

      // Update record with success
      const updatedRecord: Partial<MigrationRecord> = {
        status: "completed",
        executedAt: new Date(),
        executionTimeMs,
        metadata: {
          ...result.metadata,
          logs: this.logs,
        },
      };

      if (table) {
        await db
          .update(table)
          .set(updatedRecord as any)
          .where(eq(table.version, script.version));
      }

      log(`Migration ${script.version} completed in ${executionTimeMs}ms`);

      return {
        ...migrationRecord,
        ...updatedRecord,
      } as MigrationRecord;
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;

      // Update record with failure
      const updatedRecord: Partial<MigrationRecord> = {
        status: "failed",
        errorMessage: error.message,
        errorStack: error.stack,
        executionTimeMs,
        metadata: {
          logs: this.logs,
        },
      };

      if (table) {
        await db
          .update(table)
          .set(updatedRecord as any)
          .where(eq(table.version, script.version));
      }

      console.error(`MigrationService: Migration ${script.version} failed:`, error);

      return {
        ...migrationRecord,
        ...updatedRecord,
      } as MigrationRecord;
    }
  }

  /**
   * Rollback a migration
   */
  async rollbackMigration(version: string): Promise<MigrationRecord | null> {
    const db = getDatabase();
    const sqlClient = getSqlClient();
    const table = schemaManager.getTable("baasix_Migration");

    // Get the migration record
    const migration = await this.getMigrationByVersion(version);
    if (!migration) {
      console.error(`MigrationService: Migration ${version} not found`);
      return null;
    }

    if (migration.status !== "completed") {
      console.error(`MigrationService: Migration ${version} is not completed, cannot rollback`);
      return null;
    }

    if (!migration.canRollback) {
      console.error(`MigrationService: Migration ${version} does not support rollback`);
      return null;
    }

    // Load the script
    const scripts = await this.loadMigrationScripts();
    const script = scripts.find(s => s.version === version);

    if (!script || !script.down) {
      console.error(`MigrationService: Rollback function not found for migration ${version}`);
      return null;
    }

    this.logs = [];
    const log = (message: string) => {
      this.logs.push(`[${new Date().toISOString()}] ${message}`);
      console.info(`MigrationService: ${message}`);
    };

    log(`Rolling back migration: ${version}`);

    const startTime = Date.now();

    try {
      // Execute the rollback
      const context: MigrationContext = {
        db,
        sql: sqlClient,
        schemaManager,
        env,
        log,
      };

      await script.down(context);

      const executionTimeMs = Date.now() - startTime;

      // Update record
      if (table) {
        await db
          .update(table)
          .set({
            status: "rolled_back",
            rolledBackAt: new Date(),
            metadata: {
              ...migration.metadata,
              rollbackLogs: this.logs,
              rollbackExecutionTimeMs: executionTimeMs,
            },
          } as any)
          .where(eq(table.version, version));
      }

      log(`Migration ${version} rolled back in ${executionTimeMs}ms`);

      return {
        ...migration,
        status: "rolled_back",
        rolledBackAt: new Date(),
      };
    } catch (error: any) {
      console.error(`MigrationService: Rollback of ${version} failed:`, error);

      if (table) {
        await db
          .update(table)
          .set({
            metadata: {
              ...migration.metadata,
              rollbackError: error.message,
              rollbackErrorStack: error.stack,
            },
          } as any)
          .where(eq(table.version, version));
      }

      return null;
    }
  }

  /**
   * Rollback the last batch of migrations
   */
  async rollbackLastBatch(): Promise<MigrationRecord[]> {
    const db = getDatabase();
    const table = schemaManager.getTable("baasix_Migration");

    if (!table) {
      return [];
    }

    // Get the last batch number
    const lastBatchResult = await db
      .select({ batch: table.batch })
      .from(table)
      .where(eq(table.status, "completed"))
      .orderBy(desc(table.batch))
      .limit(1);

    if (!lastBatchResult[0]?.batch) {
      console.info("MigrationService: No migrations to rollback");
      return [];
    }

    const lastBatch = lastBatchResult[0].batch;

    // Get all migrations from the last batch
    const migrations = await db
      .select()
      .from(table)
      .where(and(
        eq(table.status, "completed"),
        eq(table.batch, lastBatch)
      ))
      .orderBy(desc(table.executedAt));

    const results: MigrationRecord[] = [];

    for (const migration of migrations) {
      const result = await this.rollbackMigration(migration.version);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Get the next batch number
   */
  private async getNextBatchNumber(): Promise<number> {
    const db = getDatabase();
    const table = schemaManager.getTable("baasix_Migration");

    if (!table) {
      return 1;
    }

    const result = await db
      .select({ maxBatch: sql<number>`COALESCE(MAX(${table.batch}), 0)` })
      .from(table);

    return (result[0]?.maxBatch || 0) + 1;
  }

  /**
   * Get migration status summary
   */
  async getStatus(): Promise<{
    lastMigration: MigrationRecord | null;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    pending: MigrationScript[];
  }> {
    await this.init();

    const [lastMigration, pendingMigrations, allMigrations] = await Promise.all([
      this.getLastMigration(),
      this.getPendingMigrations(),
      this.getMigrations(),
    ]);

    return {
      lastMigration,
      pendingCount: pendingMigrations.length,
      completedCount: allMigrations.filter(m => m.status === "completed").length,
      failedCount: allMigrations.filter(m => m.status === "failed").length,
      pending: pendingMigrations,
    };
  }

  /**
   * Create a new migration file
   */
  async createMigration(
    name: string, 
    options?: { 
      type?: MigrationType; 
      description?: string;
      version?: string;
    }
  ): Promise<string> {
    await this.init();

    // Generate version based on timestamp if not provided
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const version = options?.version || `${timestamp}_${name.toLowerCase().replace(/\s+/g, "_")}`;
    
    const filename = `${version}.ts`;
    const filepath = path.join(this.migrationsDir, filename);

    const template = `/**
 * Migration: ${name}
 * Version: ${version}
 * Type: ${options?.type || "custom"}
 * Description: ${options?.description || ""}
 * 
 * Created: ${new Date().toISOString()}
 */

import type { MigrationContext, MigrationResult } from "@tspvivek/baasix";

export const version = "${version}";
export const name = "${name}";
export const description = "${options?.description || ""}";
export const type = "${options?.type || "custom"}";

/**
 * Run the migration
 */
export async function up(context: MigrationContext): Promise<MigrationResult> {
  const { db, sql, schemaManager, log } = context;

  log("Starting migration...");

  // TODO: Add your migration logic here
  // Example: Add a new column
  // await sql\`ALTER TABLE "my_table" ADD COLUMN "new_column" TEXT\`;

  // Example: Create a new table
  // await sql\`CREATE TABLE IF NOT EXISTS "new_table" (
  //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  //   name TEXT NOT NULL
  // )\`;

  // Example: Update data
  // await db.update(someTable).set({ field: "value" }).where(condition);

  log("Migration completed successfully");

  return {
    success: true,
    message: "Migration completed",
    metadata: {
      // Add any relevant metadata about what was changed
    },
  };
}

/**
 * Rollback the migration (optional)
 */
export async function down(context: MigrationContext): Promise<MigrationResult> {
  const { db, sql, log } = context;

  log("Rolling back migration...");

  // TODO: Add your rollback logic here
  // This should undo everything done in the up function

  log("Rollback completed successfully");

  return {
    success: true,
    message: "Rollback completed",
  };
}

export default { version, name, description, type, up, down };
`;

    await fs.writeFile(filepath, template, "utf-8");
    console.info(`MigrationService: Created migration file ${filepath}`);

    return filepath;
  }

  /**
   * Check and run migrations on startup if enabled
   * This should be called during app initialization
   */
  async runStartupMigrations(): Promise<void> {
    const autoRun = env.get("MIGRATIONS_AUTO_RUN") === "true";
    
    // Handle upgrade from Sequelize version
    if (this.isUpgradeFromSequelize) {
      console.info("MigrationService: ========================================");
      console.info("MigrationService: SEQUELIZE TO DRIZZLE UPGRADE DETECTED");
      console.info("MigrationService: ========================================");
      
      await this.handleSequelizeUpgrade();
      return;
    }

    if (!autoRun) {
      console.info("MigrationService: Auto-run disabled (set MIGRATIONS_AUTO_RUN=true to enable)");
      return;
    }

    console.info("MigrationService: Running startup migrations...");

    try {
      const results = await this.runPendingMigrations();
      
      if (results.length > 0) {
        const completed = results.filter(r => r.status === "completed").length;
        const failed = results.filter(r => r.status === "failed").length;
        
        console.info(`MigrationService: Startup migrations completed. Success: ${completed}, Failed: ${failed}`);
        
        if (failed > 0) {
          console.error("MigrationService: Some migrations failed. Check the baasix_Migration table for details.");
        }
      }
    } catch (error) {
      console.error("MigrationService: Error running startup migrations:", error);
    }
  }

  /**
   * Handle upgrade from Sequelize version
   * This runs the baseline migration (to handle fullName, etc.) and marks
   * all other migrations up to the upgrade baseline as completed
   */
  private async handleSequelizeUpgrade(): Promise<void> {
    const baselineVersion = env.get("MIGRATIONS_UPGRADE_BASELINE") || await this.getCurrentBaasixVersion();
    
    console.info(`MigrationService: Setting migration baseline to version: ${baselineVersion}`);
    console.info("MigrationService: Running baseline migration and marking others as completed");

    try {
      // Get all pending migrations
      const pendingScripts = await this.getPendingMigrations();
      
      // Find the initial/baseline migration (0.1.0-alpha.0) - this one should RUN
      // because it handles the fullName virtual field conversion
      const baselineMigration = pendingScripts.find(s => s.version === "0.1.0-alpha.0");
      
      // Get migrations that should be marked as completed (not run)
      const migrationsToMark = pendingScripts.filter(s => 
        s.version !== "0.1.0-alpha.0" && 
        this.compareVersions(s.version, baselineVersion) <= 0
      );

      // Run the baseline migration first (if exists and pending)
      if (baselineMigration) {
        console.info("MigrationService: Running baseline migration (handles Sequelize virtual fields)...");
        const batch = await this.getNextBatchNumber();
        const result = await this.runMigration(baselineMigration, batch);
        
        if (result.status === "failed") {
          console.error("MigrationService: Baseline migration failed:", result.errorMessage);
          throw new Error(`Baseline migration failed: ${result.errorMessage}`);
        }
        console.info("MigrationService: Baseline migration completed successfully");
      }

      // Mark other migrations as completed (without running them)
      if (migrationsToMark.length > 0) {
        console.info(`MigrationService: Marking ${migrationsToMark.length} migration(s) as completed...`);
        for (const script of migrationsToMark) {
          await this.markAsCompleted(script.version, {
            metadata: { 
              sequelizeUpgrade: true,
              skippedExecution: true,
            },
          });
        }
      }
      
      // Now run any migrations AFTER the baseline (if auto-run is enabled)
      const autoRun = env.get("MIGRATIONS_AUTO_RUN") === "true";
      if (autoRun) {
        const pending = await this.getPendingMigrations();
        if (pending.length > 0) {
          console.info(`MigrationService: Running ${pending.length} pending migration(s) after baseline...`);
          const results = await this.runPendingMigrations();
          
          const completed = results.filter(r => r.status === "completed").length;
          const failed = results.filter(r => r.status === "failed").length;
          
          console.info(`MigrationService: Post-upgrade migrations completed. Success: ${completed}, Failed: ${failed}`);
        }
      }

      console.info("MigrationService: ========================================");
      console.info("MigrationService: UPGRADE COMPLETE");
      console.info("MigrationService: ========================================");
      
      // Clear the flag so it doesn't run again
      this.isUpgradeFromSequelize = false;
    } catch (error) {
      console.error("MigrationService: Error handling Sequelize upgrade:", error);
      throw error;
    }
  }

  /**
   * Set the user migrations directory
   */
  setMigrationsDir(dir: string): void {
    this.migrationsDir = dir;
  }

  /**
   * Get the current migrations directory
   */
  getMigrationsDir(): string {
    return this.migrationsDir;
  }

  /**
   * Mark a migration as completed without running it
   * Useful for existing installations that already have the changes
   */
  async markAsCompleted(version: string, options?: { 
    metadata?: Record<string, any>;
  }): Promise<MigrationRecord | null> {
    await this.init();

    const db = getDatabase();
    const table = schemaManager.getTable("baasix_Migration");

    if (!table) {
      console.error("MigrationService: Migration table not available");
      return null;
    }

    // Check if migration already exists
    const existing = await this.getMigrationByVersion(version);
    if (existing) {
      if (existing.status === "completed") {
        console.info(`MigrationService: Migration ${version} is already completed`);
        return existing;
      }

      // Update existing record
      await db
        .update(table)
        .set({
          status: "completed",
          executedAt: new Date(),
          metadata: {
            ...existing.metadata,
            ...options?.metadata,
            markedAsCompleted: true,
          },
        } as any)
        .where(eq(table.version, version));

      return {
        ...existing,
        status: "completed",
        executedAt: new Date(),
      };
    }

    // Load the script to get metadata
    const scripts = await this.loadMigrationScripts();
    const script = scripts.find(s => s.version === version);

    if (!script) {
      console.error(`MigrationService: Migration script ${version} not found`);
      return null;
    }

    // Create new record marked as completed
    const checksum = await this.calculateChecksum(script);
    const batch = await this.getNextBatchNumber();

    const record: Partial<MigrationRecord> = {
      version: script.version,
      name: script.name,
      description: script.description,
      type: script.type || "custom",
      status: "completed",
      batch,
      executedAt: new Date(),
      checksum,
      canRollback: !!script.down,
      metadata: {
        ...options?.metadata,
        markedAsCompleted: true,
        skippedExecution: true,
      },
    };

    await db.insert(table).values(record as any);
    console.info(`MigrationService: Migration ${version} marked as completed`);

    return record as MigrationRecord;
  }

  /**
   * Mark all migrations up to a version as completed
   * Useful for bringing an existing database up to date without running migrations
   */
  async markAllAsCompleted(toVersion?: string): Promise<MigrationRecord[]> {
    await this.init();

    const pendingScripts = await this.getPendingMigrations();
    
    let scriptsToMark = pendingScripts;
    if (toVersion) {
      scriptsToMark = scriptsToMark.filter(s => 
        this.compareVersions(s.version, toVersion) <= 0
      );
    }

    const results: MigrationRecord[] = [];

    for (const script of scriptsToMark) {
      const result = await this.markAsCompleted(script.version, {
        metadata: { bulkMarked: true },
      });
      if (result) {
        results.push(result);
      }
    }

    console.info(`MigrationService: Marked ${results.length} migration(s) as completed`);
    return results;
  }

  /**
   * Get the current Baasix version from package.json
   */
  async getCurrentBaasixVersion(): Promise<string> {
    try {
      const packagePath = getProjectPath("node_modules", "@tspvivek", "baasix", "package.json");
      const packageJson = JSON.parse(await fs.readFile(packagePath, "utf-8"));
      return packageJson.version;
    } catch {
      // Try direct package.json if running from source
      try {
        const packagePath = getBaasixPath("package.json");
        const packageJson = JSON.parse(await fs.readFile(packagePath, "utf-8"));
        return packageJson.version;
      } catch {
        return "unknown";
      }
    }
  }

  /**
   * Check if database needs migrations based on current version
   */
  async checkMigrationNeeded(): Promise<{
    needed: boolean;
    lastVersion: string | null;
    currentVersion: string;
    pendingCount: number;
  }> {
    const [lastMigration, pending, currentVersion] = await Promise.all([
      this.getLastMigration(),
      this.getPendingMigrations(),
      this.getCurrentBaasixVersion(),
    ]);

    return {
      needed: pending.length > 0,
      lastVersion: lastMigration?.version || null,
      currentVersion,
      pendingCount: pending.length,
    };
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_migrationService: MigrationService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_migrationService) {
  globalThis.__baasix_migrationService = new MigrationService();
}

const migrationService = globalThis.__baasix_migrationService;
export default migrationService;
export { MigrationService };
