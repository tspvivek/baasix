/**
 * Schema Validator
 *
 * Comprehensive schema validation utilities for validating schema definitions,
 * field types, relationships, and constraints before creating collections.
 */

import { schemaManager } from './schemaManager.js';
import type { ValidationResult, FieldValidation, SchemaValidation } from '../types/index.js';

// Re-export types for backward compatibility
export type { ValidationResult, FieldValidation, SchemaValidation };

/**
 * Valid Drizzle/PostgreSQL data types
 */
const VALID_DATA_TYPES = [
  // Numeric types
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'real', 'double precision', 'decimal', 'numeric', 'float',
  // String types
  'text', 'varchar', 'char', 'string', 'html',
  // Date/Time types
  'timestamp', 'timestamp with time zone', 'date', 'time', 'datetime',
  'time with time zone', 'interval',
  // Boolean
  'boolean', 'bool',
  // JSON
  'json', 'jsonb',
  // Binary
  'bytea',
  // UUID
  'uuid',
  // Geometric (PostGIS)
  'geometry', 'geography', 'point', 'line', 'polygon',
  // Arrays
  'array',
  // Other
  'inet', 'cidr', 'macaddr',
];

/**
 * Valid relation types
 */
const VALID_RELATION_TYPES = [
  'HasOne',
  'HasMany',
  'BelongsTo',
  'BelongsToMany',
  'M2A', // Many-to-Any (polymorphic)
];

/**
 * Reserved field names (system fields)
 */
const RESERVED_FIELD_NAMES = [
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'updatedBy',
];

/**
 * Schema validator utilities
 */
const schemaValidator = {
  /**
   * Validate a complete schema definition before creation
   * @param collectionName - Name of the collection
   * @param schemaDefinition - Schema definition object
   * @returns Validation result
   * 
   * @example
   * ```typescript
   * const validation = schemaValidator.validateSchemaBeforeCreate('users', {
   *   fields: {
   *     id: { type: 'integer', primaryKey: true },
   *     email: { type: 'string', unique: true, required: true }
   *   }
   * });
   * if (!validation.valid) {
   *   console.error('Validation errors:', validation.errors);
   * }
   * ```
   */
  validateSchemaBeforeCreate(
    collectionName: string,
    schemaDefinition: any
  ): SchemaValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const fieldValidations: FieldValidation[] = [];

    // Validate collection name
    const nameValidation = schemaValidator.validateCollectionName(collectionName);
    if (!nameValidation.valid) {
      errors.push(...nameValidation.errors);
    }
    warnings.push(...nameValidation.warnings);

    // Check if collection already exists
    if (schemaManager.getSchema(collectionName)) {
      errors.push(`Collection '${collectionName}' already exists`);
    }

    // Validate schema structure
    if (!schemaDefinition || typeof schemaDefinition !== 'object') {
      errors.push('Schema definition must be an object');
      return {
        valid: false,
        errors,
        warnings,
        collectionName,
      };
    }

    // Validate fields
    if (!schemaDefinition.fields || typeof schemaDefinition.fields !== 'object') {
      errors.push('Schema must have a "fields" object');
    } else {
      let hasPrimaryKey = false;
      
      for (const [fieldName, fieldDef] of Object.entries(schemaDefinition.fields)) {
        const fieldValidation = schemaValidator.validateField(
          fieldName,
          fieldDef as any,
          collectionName
        );
        
        fieldValidations.push(fieldValidation);
        
        if (!fieldValidation.valid) {
          errors.push(...fieldValidation.errors.map(e => `Field '${fieldName}': ${e}`));
        }
        warnings.push(...fieldValidation.warnings.map(w => `Field '${fieldName}': ${w}`));

        // Check for primary key
        if ((fieldDef as any).primaryKey) {
          if (hasPrimaryKey) {
            errors.push('Multiple primary keys defined (only one allowed)');
          }
          hasPrimaryKey = true;
        }
      }

      if (!hasPrimaryKey) {
        warnings.push('No primary key defined - an "id" field will be auto-generated');
      }
    }

    // Validate associations/relations
    if (schemaDefinition.associations) {
      const relValidation = schemaValidator.validateRelationships(
        collectionName,
        schemaDefinition.associations
      );
      errors.push(...relValidation.errors);
      warnings.push(...relValidation.warnings);
    }

    // Validate indexes
    if (schemaDefinition.options?.indexes) {
      const indexValidation = schemaValidator.validateIndexes(
        schemaDefinition.fields,
        schemaDefinition.options.indexes
      );
      errors.push(...indexValidation.errors);
      warnings.push(...indexValidation.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      collectionName,
      fieldValidations,
    };
  },

  /**
   * Validate collection name
   * @param name - Collection name
   * @returns Validation result
   */
  validateCollectionName(name: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!name || typeof name !== 'string') {
      errors.push('Collection name must be a non-empty string');
      return { valid: false, errors, warnings };
    }

    // Check length
    if (name.length < 1) {
      errors.push('Collection name cannot be empty');
    }
    if (name.length > 63) {
      errors.push('Collection name too long (max 63 characters)');
    }

    // Check format (alphanumeric + underscore, must start with letter)
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
      errors.push(
        'Collection name must start with a letter and contain only letters, numbers, and underscores'
      );
    }

    // Check for reserved names
    const reservedNames = ['user', 'group', 'table', 'column', 'database', 'schema'];
    if (reservedNames.includes(name.toLowerCase())) {
      warnings.push(`'${name}' is a reserved SQL keyword - consider using a different name`);
    }

    // Check naming convention
    if (name !== name.toLowerCase()) {
      warnings.push('Collection names should be lowercase for consistency');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  /**
   * Validate a single field definition
   * @param fieldName - Field name
   * @param fieldDef - Field definition
   * @param collectionName - Collection name (for context)
   * @returns Field validation result
   */
  validateField(
    fieldName: string,
    fieldDef: any,
    collectionName?: string
  ): FieldValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate field name
    if (!fieldName || typeof fieldName !== 'string') {
      errors.push('Field name must be a non-empty string');
      return { valid: false, errors, warnings, fieldName: fieldName || 'unknown' };
    }

    // Check field name format
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)) {
      errors.push('Field name must start with a letter or underscore and contain only letters, numbers, and underscores');
    }

    // Warn about reserved field names
    if (RESERVED_FIELD_NAMES.includes(fieldName)) {
      warnings.push(`'${fieldName}' is a reserved system field name`);
    }

    // Validate field definition structure
    if (!fieldDef || typeof fieldDef !== 'object') {
      errors.push('Field definition must be an object');
      return { valid: false, errors, warnings, fieldName };
    }

    // Validate type
    const typeValidation = schemaValidator.validateFieldType(fieldDef.type);
    errors.push(...typeValidation.errors);
    warnings.push(...typeValidation.warnings);

    // Validate constraints
    if (fieldDef.unique && fieldDef.primaryKey) {
      warnings.push('Primary key is already unique - no need to specify unique constraint');
    }

    if (fieldDef.required && fieldDef.defaultValue !== undefined) {
      warnings.push('Field has both required and defaultValue - defaultValue will be used if field is omitted');
    }

    if (fieldDef.primaryKey && fieldDef.nullable) {
      errors.push('Primary key cannot be nullable');
    }

    // Validate default value type matches field type
    if (fieldDef.defaultValue !== undefined && fieldDef.type) {
      const defaultValidation = schemaValidator.validateDefaultValue(
        fieldDef.defaultValue,
        fieldDef.type
      );
      errors.push(...defaultValidation.errors);
      warnings.push(...defaultValidation.warnings);
    }

    // Validate length constraints for string types
    if (['varchar', 'char'].includes(fieldDef.type?.toLowerCase())) {
      if (!fieldDef.length && fieldDef.type.toLowerCase() !== 'text') {
        warnings.push('String field should specify length or use "text" type');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      fieldName,
    };
  },

  /**
   * Validate field type
   * @param type - Field type
   * @returns Validation result
   */
  validateFieldType(type: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!type) {
      errors.push('Field type is required');
      return { valid: false, errors, warnings };
    }

    if (typeof type !== 'string') {
      errors.push('Field type must be a string');
      return { valid: false, errors, warnings };
    }

    const normalizedType = type.toLowerCase().trim();

    // Check if type is valid
    if (!VALID_DATA_TYPES.includes(normalizedType)) {
      // Check for common typos or alternatives
      const suggestions: Record<string, string> = {
        'int': 'integer',
        'number': 'integer or float',
        'str': 'string or text',
        'bool': 'boolean',
        'datetime': 'timestamp',
      };

      if (suggestions[normalizedType]) {
        errors.push(`Invalid type '${type}' - did you mean '${suggestions[normalizedType]}'?`);
      } else {
        errors.push(`Invalid field type '${type}'`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  /**
   * Validate default value matches field type
   * @param defaultValue - Default value
   * @param fieldType - Field type
   * @returns Validation result
   */
  validateDefaultValue(defaultValue: any, fieldType: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const normalizedType = fieldType.toLowerCase().trim();

    switch (normalizedType) {
      case 'integer':
      case 'bigint':
      case 'smallint':
        if (typeof defaultValue !== 'number' || !Number.isInteger(defaultValue)) {
          errors.push(`Default value must be an integer for type '${fieldType}'`);
        }
        break;

      case 'float':
      case 'real':
      case 'double precision':
      case 'decimal':
      case 'numeric':
        if (typeof defaultValue !== 'number') {
          errors.push(`Default value must be a number for type '${fieldType}'`);
        }
        break;

      case 'boolean':
      case 'bool':
        if (typeof defaultValue !== 'boolean') {
          errors.push(`Default value must be a boolean for type '${fieldType}'`);
        }
        break;

      case 'text':
      case 'varchar':
      case 'char':
      case 'string':
        if (typeof defaultValue !== 'string') {
          errors.push(`Default value must be a string for type '${fieldType}'`);
        }
        break;

      case 'json':
      case 'jsonb':
        try {
          JSON.stringify(defaultValue);
        } catch {
          errors.push('Default value must be valid JSON');
        }
        break;

      case 'timestamp':
      case 'date':
      case 'datetime':
        if (!(defaultValue instanceof Date) && typeof defaultValue !== 'string') {
          errors.push(`Default value must be a Date or ISO string for type '${fieldType}'`);
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  /**
   * Validate relationships/associations
   * @param collectionName - Collection name
   * @param associations - Associations object
   * @returns Validation result
   */
  validateRelationships(
    collectionName: string,
    associations: any
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!associations || typeof associations !== 'object') {
      errors.push('Associations must be an object');
      return { valid: false, errors, warnings };
    }

    for (const [relationName, relationDef] of Object.entries(associations)) {
      const relDefTyped = relationDef as any;

      // Validate relation type
      if (!relDefTyped.type) {
        errors.push(`Relation '${relationName}': type is required`);
        continue;
      }

      if (!VALID_RELATION_TYPES.includes(relDefTyped.type)) {
        errors.push(
          `Relation '${relationName}': invalid type '${relDefTyped.type}' (must be one of: ${VALID_RELATION_TYPES.join(', ')})`
        );
      }

      // Validate related model/collection
      if (!relDefTyped.model) {
        errors.push(`Relation '${relationName}': model/collection is required`);
      }

      // Validate BelongsToMany specifics
      if (relDefTyped.type === 'BelongsToMany') {
        if (!relDefTyped.through) {
          errors.push(`Relation '${relationName}': 'through' table is required for BelongsToMany`);
        }
      }

      // Validate M2A (polymorphic) specifics
      if (relDefTyped.type === 'M2A') {
        if (!relDefTyped.polymorphic) {
          warnings.push(`Relation '${relationName}': M2A relations should have polymorphic flag`);
        }
      }

      // Warn about circular references
      if (relDefTyped.model === collectionName) {
        warnings.push(`Relation '${relationName}': self-referencing relation (circular reference)`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  /**
   * Validate indexes
   * @param fields - Schema fields
   * @param indexes - Index definitions
   * @returns Validation result
   */
  validateIndexes(fields: any, indexes: any[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(indexes)) {
      errors.push('Indexes must be an array');
      return { valid: false, errors, warnings };
    }

    for (let i = 0; i < indexes.length; i++) {
      const index = indexes[i];

      if (!index.fields || !Array.isArray(index.fields)) {
        errors.push(`Index ${i}: 'fields' array is required`);
        continue;
      }

      if (index.fields.length === 0) {
        errors.push(`Index ${i}: must specify at least one field`);
        continue;
      }

      // Validate that indexed fields exist
      for (const fieldName of index.fields) {
        if (!fields[fieldName]) {
          errors.push(`Index ${i}: field '${fieldName}' does not exist in schema`);
        }
      }

      // Validate index type
      if (index.type) {
        const validIndexTypes = ['BTREE', 'HASH', 'GIST', 'GIN', 'FULLTEXT'];
        if (!validIndexTypes.includes(index.type)) {
          errors.push(`Index ${i}: invalid type '${index.type}'`);
        }
      }

      // Warn about redundant unique indexes
      if (index.unique && index.fields.length === 1) {
        const fieldName = index.fields[0];
        if (fields[fieldName]?.unique || fields[fieldName]?.primaryKey) {
          warnings.push(
            `Index ${i}: field '${fieldName}' already has unique/primary constraint`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  /**
   * Validate a schema update (modifying existing schema)
   * @param collectionName - Collection name
   * @param updates - Schema updates
   * @returns Validation result
   */
  validateSchemaUpdate(
    collectionName: string,
    updates: any
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if collection exists
    const existingSchema = schemaManager.getSchema(collectionName);
    if (!existingSchema) {
      errors.push(`Collection '${collectionName}' does not exist`);
      return { valid: false, errors, warnings };
    }

    // Warn about destructive changes
    if (updates.removeFields) {
      warnings.push('Removing fields will delete data - ensure you have a backup');
    }

    if (updates.renameFields) {
      warnings.push('Renaming fields requires data migration');
    }

    // Validate new fields
    if (updates.addFields) {
      for (const [fieldName, fieldDef] of Object.entries(updates.addFields)) {
        if (existingSchema.columns[fieldName]) {
          errors.push(`Field '${fieldName}' already exists`);
        }

        const fieldValidation = schemaValidator.validateField(
          fieldName,
          fieldDef as any,
          collectionName
        );
        errors.push(...fieldValidation.errors);
        warnings.push(...fieldValidation.warnings);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },
};

export default schemaValidator;
