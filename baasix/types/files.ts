/**
 * Files Service Types
 * Types for file upload and management
 */

/**
 * File data interface
 */
export interface FileData {
  file: any;
}

/**
 * File metadata interface
 */
export interface FileMetadata {
  title?: string;
  name?: string;
  description?: string;
  storage?: string;
  folder?: string;
  type?: string;
  originalFilename?: string;
  [key: string]: any;
}

/**
 * Internal uploaded file interface (used internally by FilesService)
 * Different from import-export UploadedFile
 */
export interface InternalUploadedFile {
  path: string;
  filename: string;
  name: string;
}
