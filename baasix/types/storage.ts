/**
 * Storage Service Types
 * Types for storage providers (local, S3, etc.)
 */

import type { S3Client } from '@aws-sdk/client-s3';

/**
 * Storage provider interface
 */
export interface StorageProvider {
  driver: string;
  basePath?: string;
  s3Client?: S3Client;
  bucketName?: string;
  saveFile: (filePath: string, fileContent: Buffer | Uint8Array) => Promise<string>;
  getFile: (filePath: string) => Promise<any>;
  deleteFile: (filePath: string) => Promise<void>;
  getPublicUrl: (filePath: string) => Promise<string> | string;
}
