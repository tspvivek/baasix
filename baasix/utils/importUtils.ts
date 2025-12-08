/**
 * Import/Export Utilities
 *
 * Utilities for importing and exporting data in various formats (CSV, JSON).
 * Handles file validation, data processing, and bulk operations.
 */

import { parse as csvParse } from 'csv-parse/sync';
import { schemaManager } from './schemaManager.js';
import fieldUtils from './fieldUtils.js';
import { APIError } from './errorHandler.js';
import type { UploadedFile, ImportOptions, ExportOptions, ImportResult, ExportResult } from '../types/index.js';

// Re-export types for backward compatibility
export type { UploadedFile, ImportOptions, ExportOptions, ImportResult, ExportResult };

/**
 * Import/Export utilities object
 */
const importUtils = {
  /**
   * Validate file type
   * @param file - Uploaded file
   * @param allowedTypes - Array of allowed MIME types
   * @returns True if valid
   */
  validateFileType(file: UploadedFile, allowedTypes: string[]): boolean {
    if (!file || !file.mimetype) {
      return false;
    }

    return allowedTypes.includes(file.mimetype);
  },

  /**
   * Parse CSV file
   * @param fileBuffer - File buffer
   * @param options - CSV parse options
   * @returns Parsed data array
   */
  parseCSV(
    fileBuffer: Buffer,
    options?: {
      delimiter?: string;
      columns?: boolean | string[];
      skip_empty_lines?: boolean;
      trim?: boolean;
    }
  ): any[] {
    const defaultOptions = {
      delimiter: ',',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      ...options,
    };

    try {
      const records = csvParse(fileBuffer, defaultOptions);
      return records;
    } catch (error: any) {
      throw new Error(`CSV parsing error: ${error.message}`);
    }
  },

  /**
   * Parse JSON file
   * @param fileBuffer - File buffer
   * @returns Parsed data
   */
  parseJSON(fileBuffer: Buffer): any {
    try {
      const jsonString = fileBuffer.toString('utf-8');
      const data = JSON.parse(jsonString);
      
      // Ensure it's an array
      if (!Array.isArray(data)) {
        throw new Error('JSON data must be an array of objects');
      }

      return data;
    } catch (error: any) {
      throw new Error(`JSON parsing error: ${error.message}`);
    }
  },

  /**
   * Process CSV-specific field types
   * Handles special conversions needed for CSV data
   * @param value - Field value
   * @param fieldType - Target field type
   * @returns Processed value
   */
  processCSVSpecificFields(value: any, fieldType: string): any {
    // Handle empty/null values
    if (value === '' || value === null || value === undefined) {
      return null;
    }

    switch (fieldType) {
      case 'integer':
      case 'bigInteger':
        const intVal = parseInt(value, 10);
        return isNaN(intVal) ? null : intVal;

      case 'float':
      case 'decimal':
        const floatVal = parseFloat(value);
        return isNaN(floatVal) ? null : floatVal;

      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          const lower = value.toLowerCase().trim();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        return Boolean(value);

      case 'json':
      case 'jsonb':
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
        return value;

      case 'date':
      case 'datetime':
      case 'timestamp':
        if (value instanceof Date) return value;
        if (typeof value === 'string') {
          const date = new Date(value);
          return isNaN(date.getTime()) ? null : date;
        }
        return null;

      case 'array':
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          // Try to parse as JSON array
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [value];
          } catch {
            // Split by comma if not valid JSON
            return value.split(',').map(v => v.trim());
          }
        }
        return [value];

      case 'string':
      case 'text':
      default:
        return String(value);
    }
  },

  /**
   * Process JSON-specific field types
   * JSON data usually has better type preservation than CSV
   * @param value - Field value
   * @param fieldType - Target field type
   * @returns Processed value
   */
  processJSONSpecificFields(value: any, fieldType: string): any {
    // Handle null values
    if (value === null || value === undefined) {
      return null;
    }

    switch (fieldType) {
      case 'integer':
      case 'bigInteger':
        if (typeof value === 'number') return Math.floor(value);
        if (typeof value === 'string') {
          const intVal = parseInt(value, 10);
          return isNaN(intVal) ? null : intVal;
        }
        return null;

      case 'float':
      case 'decimal':
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          const floatVal = parseFloat(value);
          return isNaN(floatVal) ? null : floatVal;
        }
        return null;

      case 'boolean':
        return Boolean(value);

      case 'date':
      case 'datetime':
      case 'timestamp':
        if (value instanceof Date) return value;
        if (typeof value === 'string' || typeof value === 'number') {
          const date = new Date(value);
          return isNaN(date.getTime()) ? null : date;
        }
        return null;

      case 'array':
        return Array.isArray(value) ? value : [value];

      case 'json':
      case 'jsonb':
        return value; // Already parsed

      case 'string':
      case 'text':
      default:
        return String(value);
    }
  },

  /**
   * Validate import data row
   * @param row - Data row
   * @param collection - Collection name
   * @param skipValidation - Skip validation
   * @returns Validation result
   */
  validateRow(
    row: Record<string, any>,
    collection: string,
    skipValidation: boolean = false
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (skipValidation) {
      return { valid: true, errors: [] };
    }

    // Validate required fields
    const validation = fieldUtils.validateRequiredFields(collection, row);
    if (!validation.isValid) {
      errors.push(`Missing required fields: ${validation.missing.join(', ')}`);
    }

    // Validate field existence
    const schema = schemaManager.getSchema(collection);
    if (schema) {
      for (const fieldName of Object.keys(row)) {
        if (!fieldUtils.fieldExists(collection, fieldName)) {
          errors.push(`Unknown field: ${fieldName}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Apply field mapping to data row
   * @param row - Data row
   * @param mapping - Field name mapping (source -> target)
   * @returns Mapped row
   */
  applyMapping(
    row: Record<string, any>,
    mapping?: Record<string, string>
  ): Record<string, any> {
    if (!mapping || Object.keys(mapping).length === 0) {
      return row;
    }

    const mapped: Record<string, any> = {};

    for (const [sourceField, value] of Object.entries(row)) {
      const targetField = mapping[sourceField] || sourceField;
      mapped[targetField] = value;
    }

    return mapped;
  },

  /**
   * Process import data - type conversion and validation
   * @param data - Array of data rows
   * @param collection - Collection name
   * @param format - Data format
   * @param mapping - Field mapping
   * @param skipValidation - Skip validation
   * @returns Processed data and errors
   */
  processImportData(
    data: any[],
    collection: string,
    format: 'csv' | 'json',
    mapping?: Record<string, string>,
    skipValidation: boolean = false
  ): { processed: any[]; errors: Array<{ row: number; error: string; data: any }> } {
    const processed: any[] = [];
    const errors: Array<{ row: number; error: string; data: any }> = [];
    
    const schema = schemaManager.getSchema(collection);
    if (!schema && !skipValidation) {
      throw new Error(`Schema not found for collection: ${collection}`);
    }

    for (let i = 0; i < data.length; i++) {
      try {
        let row = data[i];

        // Apply field mapping
        row = importUtils.applyMapping(row, mapping);

        // Apply defaults
        row = fieldUtils.applyDefaults(collection, row);

        // Process field types
        if (schema) {
          for (const [fieldName, value] of Object.entries(row)) {
            const fieldType = fieldUtils.getFieldType(collection, fieldName);
            
            if (fieldType) {
              if (format === 'csv') {
                row[fieldName] = importUtils.processCSVSpecificFields(value, fieldType);
              } else {
                row[fieldName] = importUtils.processJSONSpecificFields(value, fieldType);
              }
            }
          }
        }

        // Validate row
        const validation = importUtils.validateRow(row, collection, skipValidation);
        if (!validation.valid) {
          errors.push({
            row: i + 1,
            error: validation.errors.join('; '),
            data: data[i],
          });
          continue;
        }

        processed.push(row);
      } catch (error: any) {
        errors.push({
          row: i + 1,
          error: error.message,
          data: data[i],
        });
      }
    }

    return { processed, errors };
  },

  /**
   * Export data to CSV
   * @param data - Data array
   * @param fields - Fields to include
   * @returns CSV string
   */
  exportToCSV(data: any[], fields?: string[]): string {
    if (data.length === 0) {
      return '';
    }

    // Determine columns
    const columns = fields || Object.keys(data[0]);

    // Build CSV header
    const header = columns.map(col => `"${col}"`).join(',');
    
    // Build CSV rows
    const rows = data.map(row => {
      return columns.map(col => {
        let value = row[col];
        
        // Convert objects/arrays to JSON strings
        if (typeof value === 'object' && value !== null) {
          value = JSON.stringify(value);
        }
        
        // Escape quotes and wrap in quotes
        if (value === null || value === undefined) {
          return '';
        }
        
        const stringValue = String(value);
        const escaped = stringValue.replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(',');
    });

    return [header, ...rows].join('\n');
  },

  /**
   * Export data to JSON
   * @param data - Data array
   * @param fields - Fields to include
   * @returns JSON string
   */
  exportToJSON(data: any[], fields?: string[]): string {
    if (fields && fields.length > 0) {
      // Filter data to only include specified fields
      const filtered = data.map(row => fieldUtils.filterFields(row, fields));
      return JSON.stringify(filtered, null, 2);
    }

    return JSON.stringify(data, null, 2);
  },

  /**
   * Chunk array into smaller batches
   * @param array - Array to chunk
   * @param size - Chunk size
   * @returns Array of chunks
   */
  chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  },

  /**
   * Get file extension
   * @param filename - Filename
   * @returns Extension without dot
   */
  getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  },

  /**
   * Detect format from file
   * @param file - Uploaded file
   * @returns Detected format or null
   */
  detectFormat(file: UploadedFile): 'csv' | 'json' | null {
    const ext = importUtils.getFileExtension(file.originalname);
    
    if (ext === 'csv') return 'csv';
    if (ext === 'json') return 'json';
    
    // Check MIME type
    if (file.mimetype === 'text/csv') return 'csv';
    if (file.mimetype === 'application/json') return 'json';
    
    return null;
  },
};

// Named exports for route compatibility
export function validateFileType(file: any, expectedExtensions: string[], expectedMimeTypes: string[], fileTypeName: string): any {
  if (!file) {
    throw new APIError(`No ${fileTypeName} file provided`, 400);
  }

  const hasValidExtension = expectedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
  const hasValidMimeType = expectedMimeTypes.some((mimeType) => file.mimetype === mimeType);

  if (!hasValidExtension && !hasValidMimeType) {
    throw new APIError(`File must be a ${fileTypeName} file`, 400);
  }

  return file;
}

export function processCSVSpecificFields(row: any, table: any): any {
  const processedRow: any = {};

  for (const [key, value] of Object.entries(row)) {
    if (value === "" || value === null || value === undefined) {
      processedRow[key] = null;
      continue;
    }

    // Check if field is JSON type and try to parse (CSV specific)
    if (typeof value === "string" && (value.trim().startsWith("{") || value.trim().startsWith("["))) {
      try {
        processedRow[key] = JSON.parse(value);
        continue;
      } catch {
        // If JSON parsing fails, continue with type conversion
      }
    }

    // For Drizzle, we don't have modelFields.type, so we skip type conversion
    // The database will handle type coercion
    processedRow[key] = value;
  }

  return processedRow;
}

export function processJSONSpecificFields(item: any, table: any): any {
  const processedItem: any = {};

  for (const [key, value] of Object.entries(item)) {
    if (value === "" || value === null || value === undefined) {
      processedItem[key] = null;
      continue;
    }

    // For Drizzle, we don't have modelFields.type, so we skip type conversion
    // The database will handle type coercion
    processedItem[key] = value;
  }

  return processedItem;
}

export default importUtils;
