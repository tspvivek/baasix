import { startServer } from "./baasix/index.js";

// Start the server when this file is run directly
// Handle async startup with proper error handling
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
