import { db } from './db.js';
import { schemaManager } from './schemaManager.js';
import { lt } from 'drizzle-orm';

/**
 * Clean up expired sessions from the database
 */
async function cleanupSessions(): Promise<number> {
  try {
    const sessionsTable = schemaManager.getTable('baasix_Sessions');

    if (!sessionsTable) {
      console.warn('baasix_Sessions table not found, skipping session cleanup');
      return 0;
    }

    // Delete sessions where expiresAt is less than current time
    const expiresAtColumn = sessionsTable['expiresAt'];

    if (!expiresAtColumn) {
      console.warn('expiresAt column not found in baasix_Sessions, skipping cleanup');
      return 0;
    }

    const result = await db
      .delete(sessionsTable)
      .where(lt(expiresAtColumn, new Date()));

    const deletedCount = (result as any).rowCount || 0;

    if (deletedCount > 0) {
      console.info(`Session cleanup: removed ${deletedCount} expired session(s)`);
    }

    return deletedCount;
  } catch (error: any) {
    console.error('Error during session cleanup:', error.message);
    return 0;
  }
}

/**
 * Start periodic cleanup of expired sessions
 */
export function startSessionCleanup(): void {
  console.info('Session cleanup service started');

  // Run initial cleanup after a short delay (to ensure tables are ready)
  setTimeout(() => {
    cleanupSessions();
  }, 5000);

  // Clean up every hour
  setInterval(async () => {
    await cleanupSessions();
  }, 3600000); // Every hour
}

export default cleanupSessions;
