/**
 * Field Utilities
 * 
 * Consolidated utilities for field validation, processing, and manipulation.
 * Brings together scattered field-related functions into a single module.
 */

import { schemaManager } from './schemaManager.js';
import { originalConsole as logger } from './logger.js';
import type { FieldInfo, FlattenedField } from '../types/index.js';

// Re-export types for backward compatibility
export type { FieldInfo, FlattenedField };

/**
 * Field utilities object
 */
const fieldUtils = {
  /**
   * Get flattened list of all fields in a collection, including nested relations
   * @param collectionName - Name of the collection
   * @param prefix - Prefix for nested fields (used in recursion)
   * @param visited - Set of visited collections to prevent circular references
   * @returns Array of flattened field objects
   * 
   * @example
   * ```typescript
   * const fields = fieldUtils.getFlattenedFields('users');
   * // Returns: [
   * //   { name: 'id', fullPath: 'id', type: 'integer', isRelation: false },
   * //   { name: 'email', fullPath: 'email', type: 'string', isRelation: false },
   * //   { name: 'posts', fullPath: 'posts', type: 'o2m', isRelation: true, relationCollection: 'posts' },
   * //   { name: 'title', fullPath: 'posts.title', type: 'string', isRelation: false }
   * // ]
   * ```
   */
  getFlattenedFields(
    collectionName: string,
    prefix: string = '',
    visited: Set<string> = new Set()
  ): FlattenedField[] {
    // Prevent circular references
    if (visited.has(collectionName)) {
      return [];
    }
    visited.add(collectionName);

    const fields: FlattenedField[] = [];
    const schema = schemaManager.getSchema(collectionName);
    
    if (!schema) {
      logger.warn(`Schema not found for collection: ${collectionName}`);
      return fields;
    }

    // Add direct fields
    for (const [fieldName, fieldDef] of Object.entries(schema.columns)) {
      const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
      const fieldDefTyped = fieldDef as any;
      
      fields.push({
        name: fieldName,
        fullPath,
        type: fieldDefTyped.dataType || 'unknown',
        collection: collectionName,
        isRelation: false,
      });
    }

    // Add relation fields and their nested fields
    const relations = schemaManager.getRelations(collectionName);
    if (relations) {
      for (const [relName, relDef] of Object.entries(relations)) {
        const fullPath = prefix ? `${prefix}.${relName}` : relName;
        const relDefTyped = relDef as any;
        const relationType = relDefTyped.type;
        const relatedCollection = relDefTyped.relatedCollection;

        // Add the relation field itself
        fields.push({
          name: relName,
          fullPath,
          type: relationType,
          collection: collectionName,
          isRelation: true,
          relationCollection: relatedCollection,
          relationType,
        });

        // Add nested fields from related collection (max depth of 3 levels)
        if (prefix.split('.').length < 2 && relatedCollection) {
          const nestedFields = fieldUtils.getFlattenedFields(
            relatedCollection,
            fullPath,
            new Set(visited)
          );
          fields.push(...nestedFields);
        }
      }
    }

    return fields;
  },

  /**
   * Validate if a field exists in a collection
   * @param collectionName - Name of the collection
   * @param fieldPath - Field path (can include dots for nested fields)
   * @returns True if field exists
   * 
   * @example
   * ```typescript
   * fieldUtils.fieldExists('users', 'email'); // true
   * fieldUtils.fieldExists('users', 'posts.title'); // true (if relation exists)
   * fieldUtils.fieldExists('users', 'nonexistent'); // false
   * ```
   */
  fieldExists(collectionName: string, fieldPath: string): boolean {
    const parts = fieldPath.split('.');
    
    // Check direct field
    if (parts.length === 1) {
      const schema = schemaManager.getSchema(collectionName);
      return schema ? fieldPath in schema.columns : false;
    }

    // Check nested field through relation
    const [relationName, ...restPath] = parts;
    const relations = schemaManager.getRelations(collectionName);
    
    if (!relations || !(relationName in relations)) {
      return false;
    }

    const relatedCollection = relations[relationName].relatedCollection;
    if (!relatedCollection) {
      return false;
    }

    return fieldUtils.fieldExists(relatedCollection, restPath.join('.'));
  },

  /**
   * Get field type
   * @param collectionName - Name of the collection
   * @param fieldPath - Field path
   * @returns Field type or null if not found
   */
  getFieldType(collectionName: string, fieldPath: string): string | null {
    const parts = fieldPath.split('.');
    
    // Get direct field type
    if (parts.length === 1) {
      const schema = schemaManager.getSchema(collectionName);
      if (!schema || !(fieldPath in schema.columns)) {
        return null;
      }
      return schema.columns[fieldPath].dataType || null;
    }

    // Get nested field type through relation
    const [relationName, ...restPath] = parts;
    const relations = schemaManager.getRelations(collectionName);
    
    if (!relations || !(relationName in relations)) {
      // Check if it's a relation type
      return null;
    }

    const relation = relations[relationName];
    
    // If this is the last part, return relation type
    if (restPath.length === 0) {
      return relation.type;
    }

    // Recurse into related collection
    const relatedCollection = relation.relatedCollection;
    if (!relatedCollection) {
      return null;
    }

    return fieldUtils.getFieldType(relatedCollection, restPath.join('.'));
  },

  /**
   * Validate field permissions for a user
   * @param collectionName - Name of the collection
   * @param fieldNames - Array of field names to check
   * @param userPermissions - User's permissions object
   * @returns Object with allowed and denied fields
   * 
   * @example
   * ```typescript
   * const result = fieldUtils.validateFieldPermissions('users', ['email', 'password'], userPerms);
   * // { allowed: ['email'], denied: ['password'] }
   * ```
   */
  validateFieldPermissions(
    collectionName: string,
    fieldNames: string[],
    userPermissions: Record<string, any>
  ): { allowed: string[]; denied: string[] } {
    const allowed: string[] = [];
    const denied: string[] = [];

    const collectionPerms = userPermissions[collectionName];
    if (!collectionPerms) {
      // No permissions defined, deny all
      return { allowed: [], denied: fieldNames };
    }

    for (const fieldName of fieldNames) {
      const fieldPerms = collectionPerms.fields?.[fieldName];
      
      if (fieldPerms === undefined) {
        // No specific field permission, check collection-level permission
        if (collectionPerms.read === true || collectionPerms.read === '*') {
          allowed.push(fieldName);
        } else {
          denied.push(fieldName);
        }
      } else if (fieldPerms.read === true || fieldPerms.read === '*') {
        allowed.push(fieldName);
      } else {
        denied.push(fieldName);
      }
    }

    return { allowed, denied };
  },

  /**
   * Get required fields for a collection
   * @param collectionName - Name of the collection
   * @returns Array of required field names
   */
  getRequiredFields(collectionName: string): string[] {
    const schema = schemaManager.getSchema(collectionName);
    if (!schema) {
      return [];
    }

    const required: string[] = [];
    for (const [fieldName, fieldDef] of Object.entries(schema.columns)) {
      const fieldDefTyped = fieldDef as any;
      if (fieldDefTyped.notNull && !fieldDefTyped.hasDefault) {
        required.push(fieldName);
      }
    }

    return required;
  },

  /**
   * Get unique fields for a collection
   * @param collectionName - Name of the collection
   * @returns Array of unique field names
   */
  getUniqueFields(collectionName: string): string[] {
    const schema = schemaManager.getSchema(collectionName);
    if (!schema) {
      return [];
    }

    const unique: string[] = [];
    for (const [fieldName, fieldDef] of Object.entries(schema.columns)) {
      const fieldDefTyped = fieldDef as any;
      if (fieldDefTyped.isUnique || fieldDefTyped.primaryKey) {
        unique.push(fieldName);
      }
    }

    return unique;
  },

  /**
   * Filter object to only include specified fields
   * @param data - Data object
   * @param allowedFields - Array of allowed field names
   * @returns Filtered object
   * 
   * @example
   * ```typescript
   * const data = { id: 1, email: 'test@test.com', password: 'secret' };
   * const safe = fieldUtils.filterFields(data, ['id', 'email']);
   * // { id: 1, email: 'test@test.com' }
   * ```
   */
  filterFields<T extends Record<string, any>>(
    data: T,
    allowedFields: string[]
  ): Partial<T> {
    const filtered: Partial<T> = {};
    
    for (const field of allowedFields) {
      if (field in data) {
        filtered[field as keyof T] = data[field];
      }
    }

    return filtered;
  },

  /**
   * Remove specified fields from object
   * @param data - Data object
   * @param excludeFields - Array of field names to exclude
   * @returns Object without excluded fields
   */
  excludeFields<T extends Record<string, any>>(
    data: T,
    excludeFields: string[]
  ): Partial<T> {
    const result: Partial<T> = { ...data };
    
    for (const field of excludeFields) {
      delete result[field as keyof T];
    }

    return result;
  },

  /**
   * Validate required fields are present in data
   * @param collectionName - Name of the collection
   * @param data - Data object to validate
   * @returns Object with isValid flag and missing fields
   */
  validateRequiredFields(
    collectionName: string,
    data: Record<string, any>
  ): { isValid: boolean; missing: string[] } {
    const required = fieldUtils.getRequiredFields(collectionName);
    const missing: string[] = [];

    for (const field of required) {
      if (!(field in data) || data[field] === null || data[field] === undefined) {
        missing.push(field);
      }
    }

    return {
      isValid: missing.length === 0,
      missing,
    };
  },

  /**
   * Get default values for fields that have them
   * @param collectionName - Name of the collection
   * @returns Object with field names and default values
   */
  getDefaultValues(collectionName: string): Record<string, any> {
    const schema = schemaManager.getSchema(collectionName);
    if (!schema) {
      return {};
    }

    const defaults: Record<string, any> = {};
    for (const [fieldName, fieldDef] of Object.entries(schema.columns)) {
      const fieldDefTyped = fieldDef as any;
      if (fieldDefTyped.hasDefault && fieldDefTyped.default !== undefined) {
        defaults[fieldName] = fieldDefTyped.default;
      }
    }

    return defaults;
  },

  /**
   * Apply default values to data object
   * @param collectionName - Name of the collection
   * @param data - Data object
   * @returns Data object with defaults applied
   */
  applyDefaults(collectionName: string, data: Record<string, any>): Record<string, any> {
    const defaults = fieldUtils.getDefaultValues(collectionName);
    const result = { ...data };

    for (const [field, defaultValue] of Object.entries(defaults)) {
      if (!(field in result) || result[field] === undefined) {
        result[field] = defaultValue;
      }
    }

    return result;
  },

  /**
   * Get system fields (created_at, updated_at, deleted_at, etc.)
   * @param collectionName - Name of the collection
   * @returns Array of system field names
   */
  getSystemFields(collectionName: string): string[] {
    const systemFields = ['createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy'];
    const schema = schemaManager.getSchema(collectionName);
    
    if (!schema) {
      return [];
    }

    return systemFields.filter(field => field in schema.columns);
  },

  /**
   * Get user-defined fields (excludes system fields)
   * @param collectionName - Name of the collection
   * @returns Array of user-defined field names
   */
  getUserFields(collectionName: string): string[] {
    const schema = schemaManager.getSchema(collectionName);
    if (!schema) {
      return [];
    }

    const systemFields = fieldUtils.getSystemFields(collectionName);
    return Object.keys(schema.columns).filter(field => !systemFields.includes(field));
  },

  /**
   * Sanitize field name for safe use in queries
   * @param fieldName - Field name to sanitize
   * @returns Sanitized field name
   */
  sanitizeFieldName(fieldName: string): string {
    // Remove dangerous characters, only allow alphanumeric, underscore, and dot
    return fieldName.replace(/[^a-zA-Z0-9_.]/g, '');
  },

  /**
   * Parse field path into parts
   * @param fieldPath - Field path (e.g., "user.posts.title")
   * @returns Array of path parts
   */
  parseFieldPath(fieldPath: string): string[] {
    return fieldPath.split('.').filter(part => part.length > 0);
  },

  /**
   * Build field path from parts
   * @param parts - Array of path parts
   * @returns Field path string
   */
  buildFieldPath(parts: string[]): string {
    return parts.join('.');
  },

  /**
   * Get list of hidden fields in a collection
   * Hidden fields should never be returned in API responses
   * @param collectionName - Name of the collection
   * @returns Array of hidden field names
   */
  getHiddenFields(collectionName: string): string[] {
    const schema = schemaManager.getSchema(collectionName);
    if (!schema || !schema.columns) {
      return [];
    }

    const hiddenFields: string[] = [];
    for (const [fieldName, fieldDef] of Object.entries(schema.columns)) {
      if ((fieldDef as any).hidden === true) {
        hiddenFields.push(fieldName);
      }
    }
    return hiddenFields;
  },

  /**
   * Strip hidden fields from a record
   * @param collectionName - Name of the collection
   * @param record - Record to strip hidden fields from
   * @returns Record without hidden fields
   */
  stripHiddenFields<T extends Record<string, any>>(
    collectionName: string,
    record: T
  ): T {
    const hiddenFields = fieldUtils.getHiddenFields(collectionName);
    if (hiddenFields.length === 0) {
      return record;
    }

    const result = { ...record };
    for (const field of hiddenFields) {
      delete result[field];
    }
    return result;
  },

  /**
   * Strip hidden fields from an array of records
   * @param collectionName - Name of the collection
   * @param records - Array of records to strip hidden fields from
   * @returns Array of records without hidden fields
   */
  stripHiddenFieldsFromRecords<T extends Record<string, any>>(
    collectionName: string,
    records: T[]
  ): T[] {
    const hiddenFields = fieldUtils.getHiddenFields(collectionName);
    if (hiddenFields.length === 0) {
      return records;
    }

    return records.map(record => {
      const result = { ...record };
      for (const field of hiddenFields) {
        delete result[field];
      }
      return result;
    });
  },
};

export default fieldUtils;
