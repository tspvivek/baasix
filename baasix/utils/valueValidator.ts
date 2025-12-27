/**
 * Value Validator
 * 
 * Runtime validation for field values based on schema validation rules.
 * Enforces min, max, isInt, and other validation rules during create/update operations.
 */

import { schemaManager } from './schemaManager.js';
import { APIError } from './errorHandler.js';

/**
 * Validation rule interface
 */
export interface ValidationRules {
  min?: number;
  max?: number;
  isInt?: boolean;
  isEmail?: boolean;
  isUrl?: boolean;
  notEmpty?: boolean;
  len?: [number, number];
  is?: string; // regex pattern
  matches?: string; // alias for is
}

/**
 * Validation error interface
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  rule?: string;
}

/**
 * Check if a field type is numeric
 */
function isNumericType(type: string): boolean {
  const numericTypes = [
    'integer', 'bigint', 'smallint', 'decimal', 'numeric',
    'float', 'real', 'double', 'double precision',
    'Integer', 'BigInt', 'SmallInt', 'Decimal', 'Numeric',
    'Float', 'Real', 'Double',
  ];
  return numericTypes.includes(type.toLowerCase()) || numericTypes.includes(type);
}

/**
 * Check if a field type is an array of numbers
 */
function isNumericArrayType(type: string): boolean {
  const arrayNumericTypes = [
    'Array_Integer', 'Array_BigInt', 'Array_Double', 'Array_Decimal', 'Array_Float',
    'array_integer', 'array_bigint', 'array_double', 'array_decimal', 'array_float',
  ];
  return arrayNumericTypes.some(t => type.toLowerCase() === t.toLowerCase());
}

/**
 * Check if a field type is a numeric range
 */
function isNumericRangeType(type: string): boolean {
  const rangeNumericTypes = [
    'Range_Integer', 'Range_BigInt', 'Range_Double', 'Range_Decimal',
    'range_integer', 'range_bigint', 'range_double', 'range_decimal',
  ];
  return rangeNumericTypes.some(t => type.toLowerCase() === t.toLowerCase());
}

/**
 * Validate a single numeric value against min/max rules
 */
function validateNumericValue(
  value: number,
  rules: ValidationRules,
  fieldName: string,
  context?: string
): ValidationError | null {
  const contextPrefix = context ? `${context} ` : '';

  if (rules.min !== undefined && value < rules.min) {
    return {
      field: fieldName,
      message: `${contextPrefix}Value ${value} is less than minimum ${rules.min}`,
      value,
      rule: 'min',
    };
  }

  if (rules.max !== undefined && value > rules.max) {
    return {
      field: fieldName,
      message: `${contextPrefix}Value ${value} is greater than maximum ${rules.max}`,
      value,
      rule: 'max',
    };
  }

  if (rules.isInt && !Number.isInteger(value)) {
    return {
      field: fieldName,
      message: `${contextPrefix}Value ${value} must be an integer`,
      value,
      rule: 'isInt',
    };
  }

  return null;
}

/**
 * Validate array of numeric values
 */
function validateNumericArray(
  values: any[],
  rules: ValidationRules,
  fieldName: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Array.isArray(values)) {
    return errors;
  }

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value === 'number' && !isNaN(value)) {
      const error = validateNumericValue(value, rules, fieldName, `Array element [${i}]:`);
      if (error) {
        errors.push(error);
      }
    }
  }

  return errors;
}

/**
 * Validate range value (lower/upper bounds)
 */
function validateRangeValue(
  rangeValue: { lower?: number; upper?: number; lowerInclusive?: boolean; upperInclusive?: boolean },
  rules: ValidationRules,
  fieldName: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!rangeValue || typeof rangeValue !== 'object') {
    return errors;
  }

  // Validate lower bound
  if (rangeValue.lower !== undefined && rangeValue.lower !== null && typeof rangeValue.lower === 'number') {
    const lowerError = validateNumericValue(rangeValue.lower, rules, fieldName, 'Lower bound:');
    if (lowerError) {
      errors.push(lowerError);
    }
  }

  // Validate upper bound
  if (rangeValue.upper !== undefined && rangeValue.upper !== null && typeof rangeValue.upper === 'number') {
    const upperError = validateNumericValue(rangeValue.upper, rules, fieldName, 'Upper bound:');
    if (upperError) {
      errors.push(upperError);
    }
  }

  // Validate that lower <= upper (if both are present)
  if (
    rangeValue.lower !== undefined && rangeValue.lower !== null &&
    rangeValue.upper !== undefined && rangeValue.upper !== null &&
    typeof rangeValue.lower === 'number' && typeof rangeValue.upper === 'number'
  ) {
    if (rangeValue.lower > rangeValue.upper) {
      errors.push({
        field: fieldName,
        message: `Lower bound (${rangeValue.lower}) cannot be greater than upper bound (${rangeValue.upper})`,
        value: rangeValue,
        rule: 'range',
      });
    }
  }

  return errors;
}

/**
 * Validate string value
 */
function validateStringValue(
  value: string,
  rules: ValidationRules,
  fieldName: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof value !== 'string') {
    return errors;
  }

  // Check notEmpty
  if (rules.notEmpty && value.trim().length === 0) {
    errors.push({
      field: fieldName,
      message: `Field cannot be empty`,
      value,
      rule: 'notEmpty',
    });
  }

  // Check length
  if (rules.len) {
    const [minLen, maxLen] = rules.len;
    if (value.length < minLen) {
      errors.push({
        field: fieldName,
        message: `Value must be at least ${minLen} characters long`,
        value,
        rule: 'len',
      });
    }
    if (value.length > maxLen) {
      errors.push({
        field: fieldName,
        message: `Value must be at most ${maxLen} characters long`,
        value,
        rule: 'len',
      });
    }
  }

  // Check email format
  if (rules.isEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      errors.push({
        field: fieldName,
        message: `Invalid email format`,
        value,
        rule: 'isEmail',
      });
    }
  }

  // Check URL format
  if (rules.isUrl) {
    try {
      new URL(value);
    } catch {
      errors.push({
        field: fieldName,
        message: `Invalid URL format`,
        value,
        rule: 'isUrl',
      });
    }
  }

  // Check regex pattern
  const pattern = rules.is || rules.matches;
  if (pattern) {
    try {
      const regex = new RegExp(pattern);
      if (!regex.test(value)) {
        errors.push({
          field: fieldName,
          message: `Value does not match required pattern`,
          value,
          rule: 'pattern',
        });
      }
    } catch (e) {
      // Invalid regex, skip validation
      console.warn(`Invalid regex pattern for field ${fieldName}: ${pattern}`);
    }
  }

  return errors;
}

/**
 * Value validator utility
 */
export const valueValidator = {
  /**
   * Validate data against schema validation rules
   * @param collection - Collection name
   * @param data - Data to validate
   * @param isUpdate - Whether this is an update operation (only validates provided fields)
   * @returns Array of validation errors (empty if valid)
   */
  async validateData(
    collection: string,
    data: Record<string, any>,
    isUpdate: boolean = false
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Get schema definition
    const schemaDefinition = await schemaManager.getSchemaDefinition(collection);
    if (!schemaDefinition?.fields) {
      return errors;
    }

    const fields = schemaDefinition.fields;

    // Validate each field in the data
    for (const [fieldName, value] of Object.entries(data)) {
      // Skip null/undefined values (handled by allowNull constraint)
      if (value === null || value === undefined) {
        continue;
      }

      const fieldSchema = fields[fieldName];
      if (!fieldSchema) {
        continue; // Skip unknown fields (may be relation fields)
      }

      const fieldType = fieldSchema.type;
      const validate = fieldSchema.validate as ValidationRules | undefined;

      if (!validate) {
        continue; // No validation rules defined
      }

      // Validate based on field type
      if (isNumericType(fieldType)) {
        // Simple numeric field
        if (typeof value === 'number' && !isNaN(value)) {
          const error = validateNumericValue(value, validate, fieldName);
          if (error) {
            errors.push(error);
          }
        }
      } else if (isNumericArrayType(fieldType)) {
        // Array of numbers
        const arrayErrors = validateNumericArray(value, validate, fieldName);
        errors.push(...arrayErrors);
      } else if (isNumericRangeType(fieldType)) {
        // Range type
        const rangeErrors = validateRangeValue(value, validate, fieldName);
        errors.push(...rangeErrors);
      } else if (fieldType.toLowerCase() === 'string' || fieldType.toLowerCase() === 'text') {
        // String type
        const stringErrors = validateStringValue(value, validate, fieldName);
        errors.push(...stringErrors);
      }
    }

    return errors;
  },

  /**
   * Validate data and throw APIError if invalid
   * @param collection - Collection name
   * @param data - Data to validate
   * @param isUpdate - Whether this is an update operation
   * @throws APIError if validation fails
   */
  async validateOrThrow(
    collection: string,
    data: Record<string, any>,
    isUpdate: boolean = false
  ): Promise<void> {
    const errors = await this.validateData(collection, data, isUpdate);

    if (errors.length > 0) {
      const errorMessages = errors.map(e => `${e.field}: ${e.message}`).join('; ');
      throw new APIError(`Validation failed: ${errorMessages}`, 400, {
        code: 'VALIDATION_ERROR',
        errors,
      });
    }
  },

  /**
   * Check if a value is valid for a specific field
   * @param collection - Collection name
   * @param fieldName - Field name
   * @param value - Value to validate
   * @returns Validation errors for this field
   */
  async validateField(
    collection: string,
    fieldName: string,
    value: any
  ): Promise<ValidationError[]> {
    return this.validateData(collection, { [fieldName]: value });
  },
};

export default valueValidator;
