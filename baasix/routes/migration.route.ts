import { Express, Request, Response, NextFunction } from "express";
import migrationService from "../services/MigrationService.js";
import { APIError } from "../utils/errorHandler.js";
import { adminOnly } from "../utils/auth.js";

const registerEndpoint = (app: Express, _context: any) => {

  /**
   * Get migration status
   * Returns information about pending, completed, and failed migrations
   */
  app.get("/migrations/status", adminOnly, async (req, res, next) => {
    try {
      const status = await migrationService.getStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get all migrations
   * Optionally filter by status or type
   */
  app.get("/migrations", adminOnly, async (req, res, next) => {
    try {
      const { status, type } = req.query;
      
      const migrations = await migrationService.getMigrations({
        status: status as any,
        type: type as any,
      });

      res.json({ data: migrations });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get pending migrations
   */
  app.get("/migrations/pending", adminOnly, async (req, res, next) => {
    try {
      const pending = await migrationService.getPendingMigrations();
      res.json({ data: pending });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get a specific migration by version
   */
  app.get("/migrations/:version", adminOnly, async (req, res, next) => {
    try {
      const { version } = req.params;
      const migration = await migrationService.getMigrationByVersion(version);

      if (!migration) {
        return next(new APIError("Migration not found", 404));
      }

      res.json({ data: migration });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Run pending migrations
   * Body options:
   * - version: Run only specific migration version
   * - toVersion: Run migrations up to and including this version
   * - step: Number of migrations to run
   * - dryRun: Preview without executing
   */
  app.post("/migrations/run", adminOnly, async (req, res, next) => {
    try {
      const options = req.body || {};
      
      console.info("Running migrations with options:", options);

      const results = await migrationService.runPendingMigrations({
        version: options.version,
        toVersion: options.toVersion,
        step: options.step,
        dryRun: options.dryRun,
      });

      const completed = results.filter(r => r.status === "completed").length;
      const failed = results.filter(r => r.status === "failed").length;

      res.json({
        data: {
          results,
          summary: {
            total: results.length,
            completed,
            failed,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Rollback a specific migration
   */
  app.post("/migrations/rollback/:version", adminOnly, async (req, res, next) => {
    try {
      const { version } = req.params;
      
      console.info(`Rolling back migration: ${version}`);

      const result = await migrationService.rollbackMigration(version);

      if (!result) {
        return next(new APIError("Failed to rollback migration", 400));
      }

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Rollback the last batch of migrations
   */
  app.post("/migrations/rollback-batch", adminOnly, async (req, res, next) => {
    try {
      console.info("Rolling back last batch of migrations");

      const results = await migrationService.rollbackLastBatch();

      res.json({
        data: {
          results,
          summary: {
            total: results.length,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Create a new migration file
   * Body:
   * - name: Migration name (required)
   * - type: Migration type (system, schema, data, custom)
   * - description: Migration description
   * - version: Custom version (optional, auto-generated if not provided)
   */
  app.post("/migrations/create", adminOnly, async (req, res, next) => {
    try {
      const { name, type, description, version } = req.body;

      if (!name) {
        return next(new APIError("Migration name is required", 400));
      }

      const filepath = await migrationService.createMigration(name, {
        type,
        description,
        version,
      });

      res.json({
        data: {
          filepath,
          message: "Migration file created successfully",
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Mark a specific migration as completed without running it
   * Useful for existing installations that already have the changes
   */
  app.post("/migrations/mark-completed/:version", adminOnly, async (req, res, next) => {
    try {
      const { version } = req.params;
      const { metadata } = req.body || {};

      console.info(`Marking migration ${version} as completed`);

      const result = await migrationService.markAsCompleted(version, { metadata });

      if (!result) {
        return next(new APIError("Failed to mark migration as completed", 400));
      }

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Mark all pending migrations as completed up to a version
   * Useful for bringing an existing database up to date without running migrations
   * Body:
   * - toVersion: Mark migrations up to and including this version (optional, marks all if not provided)
   */
  app.post("/migrations/mark-all-completed", adminOnly, async (req, res, next) => {
    try {
      const { toVersion } = req.body || {};

      console.info(`Marking all migrations as completed${toVersion ? ` up to ${toVersion}` : ""}`);

      const results = await migrationService.markAllAsCompleted(toVersion);

      res.json({
        data: {
          results,
          summary: {
            total: results.length,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Check if migrations are needed
   */
  app.get("/migrations/check", adminOnly, async (req, res, next) => {
    try {
      const check = await migrationService.checkMigrationNeeded();
      res.json({ data: check });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "migration",
  handler: registerEndpoint,
};
