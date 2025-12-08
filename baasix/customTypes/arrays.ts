/**
 * Custom PostgreSQL array types for Drizzle ORM
 * Matches Sequelize's ARRAY(DataTypes.XXX) functionality
 */

import { customType } from 'drizzle-orm/pg-core';

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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',').map(Number);
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',').map(BigInt);
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    // Simple parser - may need enhancement for complex cases
    return value.replace(/^{|}$/g, '').split(',').map(v => 
      v.replace(/^"|"$/g, '').replace(/\\"/g, '"')
    );
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',');
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',').map(v => v === 't' || v === 'true');
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',').map(Number);
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',').map(Number);
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',').map(v => new Date(v));
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',').map(v => new Date(v));
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',');
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',');
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',');
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
  fromDriver(value: string) {
    if (!value || value === '{}') return [];
    return value.replace(/[{}]/g, '').split(',');
  },
})(name);
