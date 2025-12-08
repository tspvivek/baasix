import env from "../utils/env.js";
import { getCache } from "../utils/cache.js";
import { db } from "../utils/db.js";
import { schemaManager } from "../utils/schemaManager.js";
import { eq, lte, and } from "drizzle-orm";
import { hooksManager } from "./HooksManager.js";
import type { Task } from '../types/index.js';

class TasksService {
  private cache: any = null;
  private cacheKey: string = "baasix_tasks_not_started";
  private taskRunningKey: string = "baasix_task_running_state";
  private refreshInterval: number = 0;
  private refreshIntervalId: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Check if TasksService is enabled
    const isEnabled = env.get("TASK_SERVICE_ENABLED") === "true";
    if (!isEnabled) {
      console.info("TasksService is disabled (TASK_SERVICE_ENABLED=false)");
      return;
    }

    try {
      this.cache = getCache();

      // Set refresh interval from ENV with maximum of 3 hours (10800 seconds)
      const envInterval = parseInt(env.get("TASK_LIST_REFRESH_INTERVAL") || "600");
      const maxInterval = 10800; // 3 hours in seconds
      this.refreshInterval = Math.min(envInterval, maxInterval) * 1000;

      // Initialize cache with current not started tasks
      await this.refreshCache();

      if(env.get('TEST_MODE') !== 'true') {
        // Start periodic refresh
        this.startPeriodicRefresh();
      }

      // Register hooks for baasix_Tasks CRUD operations
      this.registerHooks();

      this.initialized = true;
      console.info(
        `TasksService initialized with refresh interval: ${this.refreshInterval / 1000}s (max: 3 hours), caching tasks scheduled within 4 hours`
      );
    } catch (error: any) {
      console.warn("TasksService: Initialization failed, will retry on first use:", error.message);
    }
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  async refreshCache(): Promise<void> {
    try {
      // Get the Task table from schema manager
      const baasixTasksTable = schemaManager.getTable("baasix_Tasks");
      
      // Calculate time 4 hours from now
      const fourHoursFromNow = new Date();
      fourHoursFromNow.setHours(fourHoursFromNow.getHours() + 4);

      // Fetch "Not started" tasks with scheduled_time within 4 hours
      const notStartedTasks = await db
        .select()
        .from(baasixTasksTable)
        .where(
          and(
            eq(baasixTasksTable.task_status, "Not started"),
            lte(baasixTasksTable.scheduled_time, fourHoursFromNow)
          )
        )
        .orderBy(baasixTasksTable.scheduled_time);

      // Cache the tasks
      await this.cache.set(this.cacheKey, JSON.stringify(notStartedTasks));

      console.info(`TasksService: Cached ${notStartedTasks.length} not started tasks (scheduled within 4 hours)`);
    } catch (error: any) {
      console.error("TasksService: Error refreshing cache:", error);
    }
  }

  async getNotStartedTasks(): Promise<Task[]> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot get tasks - initialization failed");
      return [];
    }

    try {
      const cachedTasks = await this.cache.get(this.cacheKey);
      if (cachedTasks) {
        return JSON.parse(cachedTasks);
      }

      // If cache is empty, refresh and return
      await this.refreshCache();
      const refreshedTasks = await this.cache.get(this.cacheKey);
      return refreshedTasks ? JSON.parse(refreshedTasks) : [];
    } catch (error: any) {
      console.error("TasksService: Error getting not started tasks:", error);
      return [];
    }
  }

  async setTaskRunning(isRunning: boolean): Promise<void> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot set task running state - initialization failed");
      return;
    }

    try {
      await this.cache.set(this.taskRunningKey, isRunning.toString());
      console.info(`TasksService: Task running state set to ${isRunning}`);
    } catch (error: any) {
      console.error("TasksService: Error setting task running state:", error);
    }
  }

  async isTaskRunning(): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot check task running state - initialization failed");
      return false;
    }

    try {
      const runningState = await this.cache.get(this.taskRunningKey);
      return runningState === "true";
    } catch (error: any) {
      console.error("TasksService: Error getting task running state:", error);
      return false;
    }
  }

  /**
   * Try to acquire a distributed lock for task processing
   * This ensures only one instance processes tasks at a time
   * Uses Redis SETNX for atomic lock acquisition
   * @param lockTimeout - Lock expiration time in seconds (default: 300 = 5 minutes)
   * @returns True if lock acquired, false otherwise
   */
  async tryAcquireLock(lockTimeout: number = 300): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot acquire lock - initialization failed");
      return false;
    }

    try {
      // Try to acquire lock atomically using Redis SETNX
      // Only one instance will succeed
      const lockAcquired = await this.cache.tryLock(this.taskRunningKey, lockTimeout);

      if (lockAcquired) {
        console.info(`TasksService: Lock acquired successfully (expires in ${lockTimeout}s)`);
        return true;
      }

      // Lock already held by another instance
      console.info("TasksService: Lock already held by another instance");
      return false;
    } catch (error: any) {
      console.error("TasksService: Error acquiring lock:", error);
      return false;
    }
  }

  /**
   * Release the distributed lock
   * @returns True if lock released, false otherwise
   */
  async releaseLock(): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.initialized) {
      console.warn("TasksService: Cannot release lock - initialization failed");
      return false;
    }

    try {
      await this.cache.unlock(this.taskRunningKey);
      console.info("TasksService: Lock released successfully");
      return true;
    } catch (error: any) {
      console.error("TasksService: Error releasing lock:", error);
      return false;
    }
  }

  startPeriodicRefresh(): void {
    // Clear existing interval if any
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }

    // Start new interval
    this.refreshIntervalId = setInterval(async () => {
      await this.refreshCache();
    }, this.refreshInterval);

    console.info(`TasksService: Started periodic refresh every ${this.refreshInterval}ms`);
  }

  stopPeriodicRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
      console.info("TasksService: Stopped periodic refresh");
    }
  }

  registerHooks(): void {
    // Register hooks for baasix_Tasks after create, update, delete operations
    hooksManager.registerHook("baasix_Tasks", "items.create.after", async (context: any) => {
      console.info("TasksService: baasix_Tasks created, refreshing cache");
      await this.refreshCache();
      return context;
    });

    hooksManager.registerHook("baasix_Tasks", "items.update.after", async (context: any) => {
      console.info("TasksService: baasix_Tasks updated, refreshing cache");
      await this.refreshCache();
      return context;
    });

    hooksManager.registerHook("baasix_Tasks", "items.delete.after", async (context: any) => {
      console.info("TasksService: baasix_Tasks deleted, refreshing cache");
      await this.refreshCache();
      return context;
    });

    console.info("TasksService: Registered after-hooks for baasix_Tasks CRUD operations");
  }

  /**
   * Wait for any running task to complete (with timeout)
   */
  async waitForTaskCompletion(timeoutMs: number = 30000): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const startTime = Date.now();
    console.info("TasksService: Waiting for running tasks to complete...");

    while (await this.isTaskRunning()) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`TasksService: Timeout reached (${timeoutMs}ms), forcing shutdown`);
        break;
      }

      console.info("TasksService: Task still running, waiting...");
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
    }

    console.info("TasksService: No running tasks detected");
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    console.info("TasksService: Starting graceful shutdown...");

    // Wait for running tasks to complete
    await this.waitForTaskCompletion(timeoutMs);

    // Stop periodic refresh
    this.stopPeriodicRefresh();

    console.info("TasksService: Shutdown completed");
  }

  /**
   * Method to manually trigger cache refresh (useful for testing or manual operations)
   */
  async forceRefresh(): Promise<void> {
    console.info("TasksService: Force refreshing cache");
    await this.refreshCache();
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<Record<string, any>> {
    await this.ensureInitialized();
    if (!this.initialized) {
      return {
        cachedTasksCount: 0,
        isTaskRunning: false,
        refreshInterval: this.refreshInterval,
        initialized: false,
        error: "Service not initialized",
      };
    }

    try {
      const cachedTasks = await this.cache.get(this.cacheKey);
      const isRunning = await this.isTaskRunning();

      return {
        cachedTasksCount: cachedTasks ? JSON.parse(cachedTasks).length : 0,
        isTaskRunning: isRunning,
        refreshInterval: this.refreshInterval,
        refreshIntervalSeconds: this.refreshInterval / 1000,
        maxRefreshIntervalSeconds: 10800, // 3 hours
        taskTimeWindow: "4 hours",
        initialized: this.initialized,
        lastRefreshed: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error("TasksService: Error getting cache stats:", error);
      return {
        cachedTasksCount: 0,
        isTaskRunning: false,
        refreshInterval: this.refreshInterval,
        refreshIntervalSeconds: this.refreshInterval / 1000,
        maxRefreshIntervalSeconds: 10800,
        taskTimeWindow: "4 hours",
        initialized: this.initialized,
        error: error.message,
      };
    }
  }
}

// Create and export singleton instance
const tasksService = new TasksService();

export default tasksService;
