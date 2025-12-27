import env from "./utils/env.js";
import { initializeLogger, getLogger, BaasixLoggerOptions } from "./utils/logger.js";

import express from "express";
import bodyParser from "body-parser";
import { createServer } from "http";
import morgan from "morgan";
import path from "path";
import cookieParser from "cookie-parser";
import { errorHandler } from "./utils/errorHandler.js";
import { initializeCache, closeCache, getCache, isCacheInitialized } from "./utils/cache.js";
import { invalidateEntireCache } from "./services/CacheService.js";
import { loadRoutes, loadSystemRoutes } from "./utils/router.js";
import mailService from "./services/MailService.js";
import permissionService from "./services/PermissionService.js";
import storageService from "./services/StorageService.js";
import { authMiddleware } from "./utils/auth.js";
import { hooksManager } from "./services/HooksManager.js";
import { db, initializeDatabaseWithCache } from "./utils/db.js";
import { schemaManager } from "./utils/schemaManager.js";
import { startSessionCleanup } from "./utils/sessionCleanup.js";
import schedule from "node-schedule";
import { rateLimit } from "express-rate-limit";
import socketService from "./services/SocketService.js";
import tasksService from "./services/TasksService.js";
import workflowService from "./services/WorkflowService.js";
import migrationService from "./services/MigrationService.js";
import cors from "cors";
import settingsService from "./services/SettingsService.js";
import { sql } from "drizzle-orm";
import { getBaasixPath } from "./utils/dirname.js";

// Get the admin app directory path (inside the package)
const getAdminAppPath = () => getBaasixPath("app");

export const app = express();

// CORS configuration
const getStaticAllowedOrigins = () => {
  return env.get("AUTH_CORS_ALLOWED_ORIGINS")
    ? env
        .get("AUTH_CORS_ALLOWED_ORIGINS")
        .split(",")
        .map((origin) => origin.trim())
    : ["http://localhost:3000", "http://localhost:8056"];
};

let dynamicOriginsCache: string[] = [];
let lastDynamicOriginsUpdate = 0;
const DYNAMIC_ORIGINS_CACHE_TTL = 60000; // 1 minute

export const invalidateCorsCache = () => {
  dynamicOriginsCache = [];
  lastDynamicOriginsUpdate = 0;
  console.info("CORS origins cache invalidated");
};

const getAllowedOrigins = async (): Promise<string[]> => {
  const staticOrigins = getStaticAllowedOrigins();

  const now = Date.now();
  if (now - lastDynamicOriginsUpdate > DYNAMIC_ORIGINS_CACHE_TTL) {
    try {
      const settingsUrls = await settingsService.getAllSettingsUrls();
      dynamicOriginsCache = settingsUrls;
      lastDynamicOriginsUpdate = now;
      console.info(`Updated CORS origins cache with ${settingsUrls.length} dynamic URLs`);
    } catch (error) {
      console.error("Error fetching settings URLs for CORS:", error);
    }
  }

  const allOrigins = [...new Set([...staticOrigins, ...dynamicOriginsCache])];
  return allOrigins;
};

const allowAnyPort = env.get("AUTH_CORS_ALLOW_ANY_PORT") !== "false";

const isOriginAllowed = async (origin: string): Promise<boolean> => {
  const allowedOrigins = await getAllowedOrigins();

  if (!allowAnyPort) {
    return allowedOrigins.includes(origin);
  }

  try {
    const originUrl = new URL(origin);
    const originHostname = originUrl.hostname;
    const originProtocol = originUrl.protocol;

    return allowedOrigins.some((allowedOrigin) => {
      try {
        const allowedUrl = new URL(allowedOrigin);
        return allowedUrl.hostname === originHostname && allowedUrl.protocol === originProtocol;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      isOriginAllowed(origin)
        .then((allowed) => {
          if (allowed) {
            return callback(null, true);
          } else {
            console.log(`CORS: Origin "${origin}" not explicitly allowed but permitted for development`);
            return callback(null, true);
          }
        })
        .catch((error) => {
          console.error("Error checking CORS origin:", error);
          return callback(null, true);
        });
    },
    credentials: env.get("AUTH_CORS_CREDENTIALS") !== "false",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(bodyParser.json({ limit: "20mb" }));
app.use(cookieParser());
app.use(morgan("combined"));

const limiter = rateLimit({
  windowMs: parseInt(env.get("RATE_LIMIT_INTERVAL") || "5000"),
  max: parseInt(env.get("RATE_LIMIT") || "100"),
  skip: (req, res) => {
    return req.path.startsWith("/admin") || req.path === "/admin";
  },
});

app.use(limiter);

// Serve static files from the React app
const adminAppPath = getAdminAppPath();
app.use("/admin", express.static(adminAppPath));

app.get("/admin/*", (req, res) => {
  res.sendFile(path.join(adminAppPath, "index.html"));
});

let server: any = null;

/**
 * Initialize the application with all services
 */
async function initializeApp() {
  try {
    console.info("Initializing cache...");
    // Only use Redis URL if CACHE_ADAPTER is 'redis' or 'upstash'
    const cacheAdapter = env.get("CACHE_ADAPTER") || "memory";
    const cacheUri = (cacheAdapter === "redis" || cacheAdapter === "upstash") 
      ? env.get("CACHE_REDIS_URL") 
      : null;
    initializeCache({ ttl: parseInt(env.get("CACHE_TTL") || "30") * 1000, uri: cacheUri });

    // IMPORTANT: Detect Sequelize upgrade BEFORE schema initialization
    // because schemaManager.initialize() will create the baasix_Migration table
    console.info("Checking for Sequelize to Drizzle upgrade...");
    const isUpgrade = await migrationService.detectUpgradeBeforeSchemaInit();

    console.info("Initializing schema registry...");
    await schemaManager.initialize();

    console.info("Initializing migration service...");
    await migrationService.init(isUpgrade);
    // Run pending migrations if auto-run is enabled
    await migrationService.runStartupMigrations();

    console.info("Initializing settings service...");
    await settingsService.loadSettings();

    console.info("Initializing tasks service...");
    await tasksService.init();

    console.info("Initializing workflow service...");
    await workflowService.init();

    console.info("Initializing permission service...");
    await permissionService.loadPermissions();

    console.info("Initializing mail service...");
    await mailService.initialize();

    console.info("Initializing storage service...");
    storageService.initialize();

    console.info("Loading routes...");
    // Import ItemsService dynamically to avoid circular dependencies
    const { default: ItemsService } = await import('./services/ItemsService.js');

    const context = {
      db,
      permissionService,
      mailService,
      storageService,
      ItemsService,
    };

    app.use(authMiddleware);

    await loadSystemRoutes(app, context);
    await loadRoutes(app, context);

    console.info("Loading hooks...");
    await hooksManager.loadHooksFromDirectory(context);
    await hooksManager.loadSchedulesFromDirectory(context, schedule);

    app.use(errorHandler);

    console.info("App initialization complete");
  } catch (error) {
    console.error("Error initializing app:", error);
    throw error;
  }
}

/**
 * Connect to database with retry logic
 */
async function connectWithRetry(retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      // Test database connection
      await db.execute(sql`SELECT 1`);
      console.info("Database connected successfully");
      return;
    } catch (err: any) {
      console.error(`Database connection attempt ${i + 1} failed:`, err);
      if (i === retries - 1) throw err;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string) {
  console.info(`Received ${signal}. Shutting down...`);

  try {
    console.warn("Shutting down TasksService...");
    const taskWaitTime = parseInt(env.get("TASK_SHUTDOWN_WAIT_TIME") || "30") * 1000;
    await tasksService.shutdown(taskWaitTime);

    console.warn("Shutting down WorkflowService...");
    if (typeof workflowService.shutdown === 'function') {
      await workflowService.shutdown();
    }

    console.warn("Closing cache...");
    await closeCache();

    console.warn("Closing database connection...");
    // await db.close(); // Drizzle doesn't have a close method on db object

    console.warn("Shutting down server...");
    server?.close(() => {
      console.warn("Server shut down successfully");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("Forcefully shutting down");
      process.exit(1);
    }, 10000);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Graceful shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// For nodemon restarts
process.once("SIGUSR2", async () => {
  await gracefulShutdown("SIGUSR2");
  process.kill(process.pid, "SIGUSR2");
});

/**
 * Server startup options
 */
export interface StartServerOptions {
  /** Port number to listen on (default from env or 8055) */
  port?: number;
  /** Pino logger configuration options */
  logger?: BaasixLoggerOptions;
}

/**
 * Start the Baasix server
 * @param options - Server startup options including port and logger configuration
 */
export async function startServer(options?: StartServerOptions | number) {
  // Support legacy call signature: startServer(port)
  const opts: StartServerOptions = typeof options === "number" 
    ? { port: options } 
    : options || {};
  
  const serverPort = opts.port || parseInt(env.get("PORT") || "8055");

  // Initialize logger first with user-provided options
  initializeLogger(opts.logger);
  const logger = getLogger();

  try {
    // Initialize database with cache service FIRST
    logger.info("Initializing database with cache service...");
    await initializeDatabaseWithCache();

    server = createServer(app);

    await connectWithRetry();
    await initializeApp();

    // Start session cleanup (if not disabled)
    if (env.get("DISABLE_SESSION_CLEANUP") !== "true" && env.get("TEST_MODE") !== "true") {
      startSessionCleanup();
    }

    // Initialize Socket.IO if enabled
    if (env.get("SOCKET_ENABLED") === "true") {
      await socketService.initialize(server);
    }

    server.listen(serverPort, () => {
      logger.info(`🚀 Baasix Server running on port ${serverPort}`);
    });

    return app;
  } catch (error) {
    logger.error(error, "Failed to start server");
    process.exit(1);
  }
}

/**
 * Start server for testing with environment overrides
 * @param options - Testing options including environment overrides and logger configuration
 */
export async function startServerForTesting(options?: { 
  envOverrides?: Record<string, string>;
  logger?: BaasixLoggerOptions;
}) {
  const { envOverrides, logger: loggerOptions } = options || {};

  // Initialize logger for testing (default to silent or minimal logging in tests)
  initializeLogger(loggerOptions || { level: "warn" });

  try {
    // If there's an existing server instance, close it first
    if (server) {
      console.log("Closing existing server instance before starting new one");
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }

    // Set the environment for testing
    if (envOverrides && typeof envOverrides === "object") {
      // Clear env cache to ensure overrides take effect
      env.clearCache();

      for (const [key, value] of Object.entries(envOverrides)) {
        env.set(key, value);
        console.info(`Environment override for testing: ${key}=${value}`);
      }
    }

    // Initialize database with cache service FIRST
    console.info("Initializing database with cache service for testing...");
    await initializeDatabaseWithCache();

    // Create a new server instance
    server = createServer(app);

    // Connect to the database with retry logic
    await connectWithRetry();

    if (env.get("TEST_MODE") === "true") {
      // Ensure tables are destroyed and recreated for a clean test environment
      console.log("Destroying all tables before test");
      await destroyAllTablesInDB();
    }

    // Initialize the app with fresh state
    console.log("Initializing app for testing");
    await initializeApp();

    // Start session cleanup
    if (env.get("DISABLE_SESSION_CLEANUP") !== "true" && env.get("TEST_MODE") !== "true") {
      startSessionCleanup();
    }

    // Attach the server to the app for proper cleanup later
    (app as any).server = server;

    console.log("Test server ready");
    return app;
  } catch (error) {
    console.error("Failed to start server for testing:", error);
    throw error;
  }
}

/**
 * Destroy all tables in the database (for testing)
 */
export async function destroyAllTablesInDB() {
  try {
    console.log("Destroying all tables in database...");

    // Clear cache first to remove stale data (permissions, settings, auth)
    // Clear utility cache (permissions, settings, auth)
    if (isCacheInitialized()) {
      try {
        const cache = getCache();
        await cache.clear();
        console.log("Utility cache cleared successfully");
      } catch (cacheError) {
        console.warn("Failed to clear utility cache:", cacheError);
      }
    }

    // Clear CacheService (query results cache)
    try {
      await invalidateEntireCache();
      console.log("CacheService cleared successfully");
    } catch (cacheError) {
      console.warn("Failed to clear CacheService:", cacheError);
    }

    // Disable foreign key constraints for PostgreSQL (session-level setting)
    await db.execute(sql.raw("SET session_replication_role = 'replica';"));

    try {
      // Get all table names from the database, excluding PostGIS system tables
      const result = await db.execute(sql`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT IN ('spatial_ref_sys', 'geometry_columns', 'geography_columns')
      `);

      const tables = (result as any).map((row: any) => row.tablename);
      console.log(`Found ${tables.length} tables to drop`);

      // Drop all tables with CASCADE
      for (const table of tables) {
        try {
          console.log(`Dropping table: ${table}`);
          await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`));
          console.log(`Successfully dropped table: ${table}`);
        } catch (error: any) {
          console.error(`Error dropping table ${table}:`, error.message);
          // Continue with other tables rather than failing entirely
        }
      }

      console.log("Successfully dropped all tables");
    } finally {
      // Always re-enable foreign key constraints
      await db.execute(sql.raw("SET session_replication_role = 'origin';"));
    }
  } catch (error) {
    console.error("Failed to destroy all tables in DB:", error);
    throw error;
  }
}

// Export app as default for testing
export default app;
