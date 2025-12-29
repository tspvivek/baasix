/**
 * Type Mapper - JSON Schema to Drizzle Types
 * Converts Baasix JSON schema field definitions to Drizzle column definitions
 */

import {
  varchar,
  text,
  integer,
  bigint,
  decimal,
  real,
  doublePrecision,
  boolean,
  timestamp,
  date,
  time,
  json,
  jsonb,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as customTypes from '../customTypes/index.js';
import type { FieldSchema } from '../types/index.js';

// Re-export types for backward compatibility
export type { FieldSchema };

/**
 * Map JSON schema type to Drizzle column
 */
export function mapJsonTypeToDrizzle(fieldName: string, fieldSchema: FieldSchema): any {
  let column: any;

  switch (fieldSchema.type) {
    // String types
    case 'String':
      if (fieldSchema.values?.stringLength) {
        column = varchar(fieldName, { length: fieldSchema.values.stringLength });
      } else {
        column = varchar(fieldName, { length: 255 });
      }
      break;

    case 'Text':
    case 'TEXT':
      column = text(fieldName);
      break;

    case 'CiText':
      // Case-insensitive text - requires citext extension
      column = text(fieldName); // Will need custom type for citext
      break;

    case 'HTML':
      // HTML content - stored as text, displayed with WYSIWYG editor
      column = text(fieldName);
      break;

    // Numeric types
    case 'Integer':
      column = integer(fieldName);
      break;

    case 'BigInt':
      column = bigint(fieldName, { mode: 'number' });
      break;

    case 'Decimal':
      if (fieldSchema.values?.precision && fieldSchema.values?.scale) {
        column = decimal(fieldName, {
          precision: fieldSchema.values.precision,
          scale: fieldSchema.values.scale,
        });
      } else if (fieldSchema.values?.precision) {
        column = decimal(fieldName, { precision: fieldSchema.values.precision });
      } else {
        column = decimal(fieldName);
      }
      break;

    case 'Real':
      column = real(fieldName);
      break;

    case 'Double':
    case 'DOUBLE':
      column = doublePrecision(fieldName);
      break;

    // Boolean
    case 'Boolean':
      column = boolean(fieldName);
      break;

    // Date/Time types
    case 'DateTime':
      column = timestamp(fieldName, { withTimezone: true });
      break;

    case 'DateTime_NO_TZ':
      column = timestamp(fieldName, { withTimezone: false });
      break;

    case 'Date':
      column = date(fieldName);
      break;

    case 'Time':
      column = time(fieldName, { withTimezone: true });
      break;

    case 'Time_NO_TZ':
      column = time(fieldName, { withTimezone: false });
      break;

    // JSON types
    case 'JSON':
      column = json(fieldName);
      break;

    case 'JSONB':
      column = jsonb(fieldName);
      break;

    // UUID
    case 'UUID':
      column = uuid(fieldName);
      break;

    // TOKEN (9-character unique string)
    case 'TOKEN':
      column = varchar(fieldName, { length: 9 });
      break;

    // ENUM
    case 'ENUM':
      // ENUMs require pre-definition, will handle separately
      column = varchar(fieldName, { length: 255 });
      break;

    // VIRTUAL (computed fields) - uses SQL expressions directly
    // Note: The actual GENERATED column is created by schemaManager's buildColumnDefinition
    // Here we just define it as a regular text column for Drizzle's query builder
    case 'VIRTUAL':
      if (fieldSchema.calculated) {
        // For the Drizzle schema, treat as a regular text column
        // The database handles the generation automatically
        column = text(fieldName);
      } else {
        // No calculation provided, skip
        console.warn(`VIRTUAL field "${fieldName}" has no calculated expression. Skipping.`);
        return null;
      }
      break;

    // Array types
    case 'Array_Integer':
      column = customTypes.arrayInteger(fieldName);
      break;

    case 'Array_String':
      column = customTypes.arrayText(fieldName);
      break;

    case 'Array_Double':
      column = customTypes.arrayDouble(fieldName);
      break;

    case 'Array_Decimal':
      column = customTypes.arrayDecimal(fieldName);
      break;

    case 'Array_DateTime':
      column = customTypes.arrayDateTimeTz(fieldName);
      break;

    case 'Array_DateTime_NO_TZ':
      column = customTypes.arrayDateTime(fieldName);
      break;

    case 'Array_Date':
      column = customTypes.arrayDateOnly(fieldName);
      break;

    case 'Array_Time':
      column = customTypes.arrayTimeTz(fieldName);
      break;

    case 'Array_Time_NO_TZ':
      column = customTypes.arrayTime(fieldName);
      break;

    case 'Array_UUID':
      column = customTypes.arrayUuid(fieldName);
      break;

    case 'Array_Boolean':
      column = customTypes.arrayBoolean(fieldName);
      break;

    // Range types
    case 'Range_Integer':
      column = customTypes.rangeInteger(fieldName);
      break;

    case 'Range_DateTime':
      column = customTypes.rangeDateTimeTz(fieldName);
      break;

    case 'Range_DateTime_NO_TZ':
      column = customTypes.rangeDateTime(fieldName);
      break;

    case 'Range_Time':
      column = customTypes.rangeTimeTz(fieldName);
      break;

    case 'Range_Time_NO_TZ':
      column = customTypes.rangeTime(fieldName);
      break;

    case 'Range_Double':
      column = customTypes.rangeDouble(fieldName);
      break;

    case 'Range_Decimal':
      column = customTypes.rangeDecimal(fieldName);
      break;

    case 'Range_Date':
      column = customTypes.rangeDate(fieldName);
      break;

    // PostGIS Geometry types
    case 'Point':
      column = customTypes.point(fieldName, fieldSchema.values?.srid || 4326);
      break;

    case 'LineString':
      column = customTypes.lineString(fieldName, fieldSchema.values?.srid || 4326);
      break;

    case 'Polygon':
      column = customTypes.polygon(fieldName, fieldSchema.values?.srid || 4326);
      break;

    case 'MultiPoint':
      column = customTypes.multiPoint(fieldName, fieldSchema.values?.srid || 4326);
      break;

    case 'MultiLineString':
      column = customTypes.multiLineString(fieldName, fieldSchema.values?.srid || 4326);
      break;

    case 'MultiPolygon':
      column = customTypes.multiPolygon(fieldName, fieldSchema.values?.srid || 4326);
      break;

    case 'GeometryCollection':
      column = customTypes.geometryCollection(fieldName, fieldSchema.values?.srid || 4326);
      break;

    case 'Geography':
      column = customTypes.geography(fieldName, 'Point', fieldSchema.values?.srid || 4326);
      break;

    default:
      // Default to varchar
      console.warn(`Unknown field type: ${fieldSchema.type}, defaulting to varchar`);
      column = varchar(fieldName, { length: 255 });
  }

  // Apply modifiers
  if (column) {
    // Primary key
    if (fieldSchema.primaryKey) {
      column = column.primaryKey();
    }

    // Not null
    if (fieldSchema.allowNull === false) {
      column = column.notNull();
    }

    // Unique
    if (fieldSchema.unique) {
      column = column.unique();
    }

    // Default value
    if (fieldSchema.defaultValue !== undefined) {
      column = applyDefaultValue(column, fieldSchema.defaultValue, fieldSchema.type);
    }
  }

  return column;
}

/**
 * Apply default value to a column
 */
function applyDefaultValue(column: any, defaultValue: any, _fieldType: string): any {
  if (typeof defaultValue === 'object' && defaultValue.type) {
    switch (defaultValue.type) {
      case 'UUIDV4':
        return column.default(sql`gen_random_uuid()`);

      case 'SUID':
        // Short unique ID - would need a PostgreSQL function
        // For now, just use UUID
        return column.default(sql`gen_random_uuid()`);

      case 'NOW':
        return column.defaultNow();

      case 'AUTOINCREMENT':
        // Auto-increment is handled by serial type
        return column;

      case 'SQL':
        // Raw SQL default
        if (defaultValue.value) {
          return column.default(sql.raw(defaultValue.value));
        }
        return column;

      default:
        if (defaultValue.value !== undefined) {
          return column.default(defaultValue.value);
        }
        return column;
    }
  } else if (typeof defaultValue === 'object' && defaultValue.value !== undefined) {
    return column.default(defaultValue.value);
  } else {
    return column.default(defaultValue);
  }
}

/**
 * Check if a field is a relation field (not a database column)
 */
export function isRelationField(fieldSchema: FieldSchema): boolean {
  return !!fieldSchema.relType;
}

/**
 * Get relation type from field schema
 */
export function getRelationType(fieldSchema: FieldSchema): string | null {
  return fieldSchema.relType || null;
}

export default {
  mapJsonTypeToDrizzle,
  isRelationField,
  getRelationType,
};
