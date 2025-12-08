/**
 * Import/Export Types
 * Centralized import and export type definitions
 */

/**
 * Uploaded file interface
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Import options interface
 */
export interface ImportOptions {
  collection: string;
  file?: UploadedFile;
  data?: any[];
  format?: 'csv' | 'json';
  mapping?: Record<string, string>;
  skipValidation?: boolean;
  batchSize?: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, row: any, index: number) => void;
}

/**
 * Export options interface
 */
export interface ExportOptions {
  collection: string;
  format?: 'csv' | 'json';
  fields?: string[];
  filter?: any;
  limit?: number;
  offset?: number;
}

/**
 * Import result interface
 */
export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: Array<{ row: number; error: string; data?: any }>;
  duration: number;
}

/**
 * Export result interface
 */
export interface ExportResult {
  success: boolean;
  data: string | any[];
  count: number;
  format: string;
}
