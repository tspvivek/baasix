/**
 * Field Types
 * Centralized field and schema type definitions
 */

/**
 * Field information interface
 */
export interface FieldInfo {
  field: string;
  type: string;
  collection?: string;
  interface?: string;
  special?: string[];
  required?: boolean;
  unique?: boolean;
  defaultValue?: any;
  meta?: Record<string, any>;
}

/**
 * Flattened field interface
 */
export interface FlattenedField {
  name: string;
  fullPath: string;
  type: string;
  collection?: string;
  isRelation: boolean;
  relationCollection?: string;
  relationType?: string;
}

/**
 * Field validation rules interface
 */
export interface FieldValidationRules {
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
 * Field schema interface
 */
export interface FieldSchema {
  type: string;
  allowNull?: boolean;
  unique?: boolean;
  primaryKey?: boolean;
  defaultValue?: any;
  values?: any;
  calculated?: string;
  constraints?: boolean;
  foreignKey?: boolean | string;
  SystemGenerated?: string | boolean;
  description?: string;
  relType?: string;
  target?: string;
  as?: string;
  onDelete?: string;
  onUpdate?: string;
  through?: string | object;
  otherKey?: string;
  polymorphic?: boolean;
  tables?: string[];
  validate?: FieldValidationRules;
}
