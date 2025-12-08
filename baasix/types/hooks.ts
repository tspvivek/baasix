/**
 * Hooks Types
 * Types for workflow hooks
 */

/**
 * Hook definition interface (for database records)
 */
export interface Hook {
  name: string;
  collection: string;
  event: string;
  script: string;
  enabled: boolean;
  [key: string]: any;
}

/**
 * Hook handler function type
 */
export type HookHandler = (context: any, input: any, data: any) => Promise<any>;

/**
 * Internal hook interface (for in-memory hooks with handler functions)
 * Used internally by HooksManager
 */
export interface InternalHook {
  collection: string;
  event: string;
  handler: HookHandler;
}
