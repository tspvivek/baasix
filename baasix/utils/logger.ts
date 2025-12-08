import env from "./env.js";

// Custom logger that conditionally logs based on DEBUGGING environment variable
// Store original console methods
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

// Override console methods to check DEBUGGING flag
console.log = function (...args: any[]) {
  if (env.get("DEBUGGING") === "true") {
    originalConsole.log(...args);
  }
};

console.info = function (...args: any[]) {
  originalConsole.info(...args);
};

console.warn = function (...args: any[]) {
  // Always log warnings
  originalConsole.warn(...args);
};

console.error = function (...args: any[]) {
  // Always log errors
  originalConsole.error(...args);
};

console.debug = function (...args: any[]) {
  if (env.get("DEBUGGING") === "true") {
    originalConsole.debug(...args);
  }
};

// Export the original console methods in case they're needed directly
export { originalConsole };
