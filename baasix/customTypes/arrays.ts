/**
 * Custom PostgreSQL array types for Drizzle ORM
 * Matches Sequelize's ARRAY(DataTypes.XXX) functionality
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * Helper function to safely parse array values from driver
 * Handles: null, undefined, empty string, already-parsed arrays, and string representations
 */
function parseArrayValue<T>(
  value: unknown,
  mapper: (v: string) => T
): T[] {
  // Handle null/undefined
  if (value == null) return [];
  
  // Already an array (driver already parsed it)
  if (Array.isArray(value)) {
    return value.map(v => {
      if (v == null) return v as unknown as T;
      return mapper(String(v));
    });
  }
  
  // Not a string - try to convert
  if (typeof value !== 'string') {
    return [];
  }
  
  // Empty array representation
  if (value === '{}' || value === '') return [];
  
  // Parse string representation like "{1,2,3}"
  return value.replace(/[{}]/g, '').split(',').map(mapper);
}

/**
 * Helper function specifically for boolean arrays
 * Handles various boolean representations from PostgreSQL
 */
function parseBooleanArrayValue(value: unknown): boolean[] {
  // Handle null/undefined
  if (value == null) return [];
  
  // Already an array
  if (Array.isArray(value)) {
    return value.map(v => {
      if (v == null) return false;
      if (typeof v === 'boolean') return v;
      const str = String(v).toLowerCase();
      return str === 't' || str === 'true' || str === '1';
    });
  }
  
  // Not a string
  if (typeof value !== 'string') {
    return [];
  }
  
  // Empty array
  if (value === '{}' || value === '') return [];
  
  // Parse string representation
  return value.replace(/[{}]/g, '').split(',').map(v => {
    const str = v.toLowerCase();
    return str === 't' || str === 'true' || str === '1';
  });
}

/**
 * Helper for text arrays that need quote handling
 */
function parseTextArrayValue(value: unknown): string[] {
  // Handle null/undefined
  if (value == null) return [];
  
  // Already an array
  if (Array.isArray(value)) {
    return value.map(v => v == null ? '' : String(v));
  }
  
  // Not a string
  if (typeof value !== 'string') {
    return [];
  }
  
  // Empty array
  if (value === '{}' || value === '') return [];
  
  // Parse string representation
  return value.replace(/^{|}$/g, '').split(',').map(v => 
    v.replace(/^"|"$/g, '').replace(/\\"/g, '"')
  );
}

/**
 * Array of integers
 * Usage: arrayInteger('tags')
 */
export const arrayInteger = (name: string) => customType<{
  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'integer[]';
  },
  toDriver(value: number[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, Number);
  },
})(name);

/**
 * Array of big integers
 * Usage: arrayBigInt('large_numbers')
 */
export const arrayBigInt = (name: string) => customType<{
  data: bigint[];
  driverData: string;
}>({
  dataType() {
    return 'bigint[]';
  },
  toDriver(value: bigint[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, BigInt);
  },
})(name);

/**
 * Array of strings/text
 * Usage: arrayText('labels')
 */
export const arrayText = (name: string) => customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'text[]';
  },
  toDriver(value: string[]) {
    // Escape special characters and quotes
    const escaped = value.map(v => `"${v.replace(/"/g, '\\"')}"`);
    return `{${escaped.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseTextArrayValue(value);
  },
})(name);

/**
 * Array of varchar (alias for arrayText for compatibility)
 * Usage: arrayVarchar('names')
 */
export const arrayVarchar = arrayText;

/**
 * Array of UUIDs
 * Usage: arrayUuid('user_ids')
 */
export const arrayUuid = (name: string) => customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'uuid[]';
  },
  toDriver(value: string[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, String);
  },
})(name);

/**
 * Array of booleans
 * Usage: arrayBoolean('flags')
 */
export const arrayBoolean = (name: string) => customType<{
  data: boolean[];
  driverData: string;
}>({
  dataType() {
    return 'boolean[]';
  },
  toDriver(value: boolean[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseBooleanArrayValue(value);
  },
})(name);

/**
 * Array of decimals/numeric
 * Usage: arrayDecimal('prices')
 */
export const arrayDecimal = (name: string) => customType<{
  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'decimal[]';
  },
  toDriver(value: number[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, Number);
  },
})(name);

/**
 * Array of double precision
 * Usage: arrayDouble('coordinates')
 */
export const arrayDouble = (name: string) => customType<{
  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'double precision[]';
  },
  toDriver(value: number[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, Number);
  },
})(name);

/**
 * Array of timestamps with timezone
 * Usage: arrayDateTimeTz('event_times')
 */
export const arrayDateTimeTz = (name: string) => customType<{
  data: (Date | string)[];
  driverData: string;
}>({
  dataType() {
    return 'timestamptz[]';
  },
  toDriver(value: (Date | string)[]) {
    const timestamps = value.map(d => {
      if (d instanceof Date) return d.toISOString();
      if (typeof d === 'string') return new Date(d).toISOString();
      return String(d);
    });
    return `{${timestamps.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, v => new Date(v));
  },
})(name);

/**
 * Array of timestamps without timezone (legacy)
 * Usage: arrayDateTime('event_dates')
 */
export const arrayDateTime = (name: string) => customType<{
  data: (Date | string)[];
  driverData: string;
}>({
  dataType() {
    return 'timestamp[]';
  },
  toDriver(value: (Date | string)[]) {
    const timestamps = value.map(d => {
      if (d instanceof Date) return d.toISOString();
      if (typeof d === 'string') return new Date(d).toISOString();
      return String(d);
    });
    return `{${timestamps.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, v => new Date(v));
  },
})(name);

/**
 * Array of dates (timestamps) - alias for arrayDateTime for backwards compatibility
 * Usage: arrayDate('event_dates')
 */
export const arrayDate = arrayDateTime;

/**
 * Array of date only (no time)
 * Usage: arrayDateOnly('birthdays')
 */
export const arrayDateOnly = (name: string) => customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'date[]';
  },
  toDriver(value: string[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, String);
  },
})(name);

/**
 * Array of time with timezone
 * Usage: arrayTimeTz('schedule_times')
 */
export const arrayTimeTz = (name: string) => customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'timetz[]';
  },
  toDriver(value: string[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, String);
  },
})(name);

/**
 * Array of time without timezone (legacy)
 * Usage: arrayTime('schedule_times')
 */
export const arrayTime = (name: string) => customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'time[]';
  },
  toDriver(value: string[]) {
    return `{${value.join(',')}}`;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, String);
  },
})(name);

/**
 * Generic array type for custom types
 * Usage: arrayOf('custom_type[]', 'field')
 */
export const arrayOf = (arrayType: string, name: string) => customType<{
  data: any[];
  driverData: string;
}>({
  dataType() {
    return arrayType;
  },
  toDriver(value: any[]) {
    if (Array.isArray(value)) {
      return `{${value.join(',')}}`;
    }
    return value;
  },
  fromDriver(value: unknown) {
    return parseArrayValue(value, v => v);
  },
})(name);
