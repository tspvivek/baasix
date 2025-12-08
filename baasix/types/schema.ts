/**
 * Schema Validation Types
 * Centralized schema validation type definitions
 */

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Field validation interface
 */
export interface FieldValidation extends ValidationResult {
  fieldName: string;
}

/**
 * Schema validation interface
 */
export interface SchemaValidation extends ValidationResult {
  collectionName: string;
  fieldValidations?: FieldValidation[];
}
