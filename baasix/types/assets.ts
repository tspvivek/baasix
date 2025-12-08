/**
 * Assets Service Types
 * Types for asset management and processing
 */

/**
 * Asset query interface
 */
export interface AssetQuery {
  width?: string | number;
  height?: string | number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  quality?: string | number;
  withoutEnlargement?: string | boolean;
}

/**
 * Asset result interface
 */
export interface AssetResult {
  buffer: Buffer | null;
  contentType: string;
  filePath?: string | null;
  file: any;
  isS3?: boolean;
}

/**
 * Processed image interface
 */
export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
}
