import path from "path";
import { fileURLToPath } from "url";

/**
 * Check if we're in CommonJS (Jest) or ESM mode
 */
export const isCommonJS = typeof __dirname !== 'undefined';

// Cache the baasix root to avoid repeated computation
let cachedBaasixRoot: string | null = null;

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
  
  // In ESM, we need to use import.meta.url
  // Use Function constructor to avoid syntax error during CommonJS parsing
  // This code path only runs in ESM mode where import.meta is available
  try {
    const getImportMetaUrl = new Function('return import.meta.url');
    const importMetaUrl = getImportMetaUrl();
    const currentDir = path.dirname(fileURLToPath(importMetaUrl));
    cachedBaasixRoot = path.resolve(currentDir, '..');
    return cachedBaasixRoot;
  } catch {
    // Fallback if Function constructor doesn't work
    cachedBaasixRoot = path.join(process.cwd(), 'baasix');
    return cachedBaasixRoot;
  }
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
