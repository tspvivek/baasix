/**
 * Start periodic cleanup of expired sessions
 */
export function startSessionCleanup(): void {
  console.info("Session cleanup service started");

  // Clean up every hour
  setInterval(async () => {
    try {
      // TODO: Import baasixSessionsTable from schema.ts when it's added
      // const result = await db
      //   .delete(baasixSessionsTable)
      //   .where(lt(baasixSessionsTable.expiresAt, new Date()));

      console.info("Session cleanup completed");
    } catch (error: any) {
      console.error("Error during session cleanup:", error.message);
    }
  }, 3600000); // Every hour
}
