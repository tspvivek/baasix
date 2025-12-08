import dotenv from "dotenv";
import { fileURLToPath } from "url";

// Load environment variables for testing
dotenv.config({ path: ".env.test" });

// Set environment to test mode
process.env.NODE_ENV = "test";

// Mock import.meta for CommonJS environment
globalThis.import = globalThis.import || {};
globalThis.import.meta = globalThis.import.meta || {};
globalThis.import.meta.url = 'file://' + process.cwd() + '/index.js';



