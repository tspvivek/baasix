import path from "path";
import { fileURLToPath } from "url";

/**
 * Check if we're in CommonJS (Jest) or ESM mode
 */
export const isCommonJS = typeof __dirname !== 'undefined';

// Cache the baasix root to avoid repeated computation
let cachedBaasixRoot: string | null = null;

/**
 * Get the current file's directory using error stack trace
 * This works in both ESM and CommonJS environments
 */
function getCurrentFilePath(): string | undefined {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  try {
    const err = new Error();
    Error.prepareStackTrace = (_, stack) => stack;
    const stack = err.stack as unknown as NodeJS.CallSite[];
    Error.prepareStackTrace = originalPrepareStackTrace;
    
    // Find the first stack frame that's in this file (dirname.js or dirname.ts)
    for (const frame of stack) {
      const filename = frame.getFileName();
      if (filename && (filename.includes('dirname.js') || filename.includes('dirname.ts'))) {
        // Handle file:// URLs
        if (filename.startsWith('file://')) {
          return fileURLToPath(filename);
        }
        return filename;
      }
    }
  } catch {
    // Fallback if stack trace approach fails
  }
  return undefined;
}

/**
 * Get the baasix package root directory
 * Works in both ESM (production) and CommonJS (Jest) environments
 */
export function getBaasixRoot(): string {
  if (cachedBaasixRoot) {
    return cachedBaasixRoot;
  }
  
  if (isCommonJS) {
    // In Jest/CommonJS, __dirname is available
    // This file is at baasix/utils/dirname.ts, so go up one level
    cachedBaasixRoot = path.resolve(__dirname, '..');
    return cachedBaasixRoot;
  }
  
  // In ESM, use stack trace to get current file path
  const currentFilePath = getCurrentFilePath();
  if (currentFilePath) {
    const currentDir = path.dirname(currentFilePath);
    cachedBaasixRoot = path.resolve(currentDir, '..');
    return cachedBaasixRoot;
  }
  
  // Fallback (should not reach here in normal circumstances)
  cachedBaasixRoot = path.join(process.cwd(), 'baasix');
  return cachedBaasixRoot;
}

/**
 * Get a path relative to the baasix package root
 * @param relativePath - Path relative to baasix root (e.g., 'routes', 'app', 'templates')
 */
export function getBaasixPath(...relativePath: string[]): string {
  return path.join(getBaasixRoot(), ...relativePath);
}

/**
 * Get the user's project directory
 */
export function getProjectDir(): string {
  return process.cwd();
}

/**
 * Get a path relative to the user's project
 * @param relativePath - Path relative to project root (e.g., 'extensions', 'migrations')
 */
export function getProjectPath(...relativePath: string[]): string {
  return path.join(getProjectDir(), ...relativePath);
}
