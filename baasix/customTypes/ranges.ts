/**
 * Custom PostgreSQL range types for Drizzle ORM
 * Matches Sequelize's RANGE(DataTypes.XXX) functionality
 */

import { customType } from 'drizzle-orm/pg-core';

export interface Range<T> {
  lower: T;
  upper: T;
  lowerInclusive?: boolean;
  upperInclusive?: boolean;
}

/**
 * Integer range type
 * Usage: rangeInteger('age_range')
 */
export const rangeInteger = (name: string) => customType<{
  data: Range<number>;
  driverData: string;
}>({
  dataType() {
    return 'int4range';
  },
  toDriver(value: Range<number>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    return `${lowerBracket}${value.lower},${value.upper}${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]([^,]+),([^\]\)]+)[\]\)]/);
    if (!match) return { lower: 0, upper: 0, lowerInclusive, upperInclusive };
    
    return {
      lower: parseInt(match[1]),
      upper: parseInt(match[2]),
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);

/**
 * Big integer range type
 * Usage: rangeBigInt('large_range')
 */
export const rangeBigInt = (name: string) => customType<{
  data: Range<bigint>;
  driverData: string;
}>({
  dataType() {
    return 'int8range';
  },
  toDriver(value: Range<bigint>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    return `${lowerBracket}${value.lower},${value.upper}${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]([^,]+),([^\]\)]+)[\]\)]/);
    if (!match) return { lower: BigInt(0), upper: BigInt(0), lowerInclusive, upperInclusive };
    
    return {
      lower: BigInt(match[1]),
      upper: BigInt(match[2]),
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);

/**
 * Numeric/decimal range type
 * Usage: rangeDecimal('price_range')
 */
export const rangeDecimal = (name: string) => customType<{
  data: Range<number>;
  driverData: string;
}>({
  dataType() {
    return 'numrange';
  },
  toDriver(value: Range<number>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    return `${lowerBracket}${value.lower},${value.upper}${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]([^,]+),([^\]\)]+)[\]\)]/);
    if (!match) return { lower: 0, upper: 0, lowerInclusive, upperInclusive };
    
    return {
      lower: parseFloat(match[1]),
      upper: parseFloat(match[2]),
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);

/**
 * Date range type (no time)
 * Usage: rangeDate('event_period')
 */
export const rangeDate = (name: string) => customType<{
  data: Range<string | Date>;
  driverData: string;
}>({
  dataType() {
    return 'daterange';
  },
  toDriver(value: Range<string | Date>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    // Handle Date objects, ISO strings, or date-only strings
    const formatDate = (d: string | Date) => {
      if (d instanceof Date) return d.toISOString().split('T')[0];
      if (typeof d === 'string' && d.includes('T')) return d.split('T')[0];
      return d;
    };
    const lower = formatDate(value.lower);
    const upper = formatDate(value.upper);
    return `${lowerBracket}${lower},${upper}${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]([^,]+),([^\]\)]+)[\]\)]/);
    if (!match) return { lower: '', upper: '', lowerInclusive, upperInclusive };
    
    return {
      lower: match[1],
      upper: match[2],
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);

/**
 * Timestamp range type (with time)
 * Usage: rangeDateTime('booking_period')
 */
export const rangeDateTime = (name: string) => customType<{
  data: Range<Date | string>;
  driverData: string;
}>({
  dataType() {
    return 'tsrange';
  },
  toDriver(value: Range<Date | string>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    // Handle both Date objects and ISO strings
    const formatDateTime = (d: Date | string) => {
      if (d instanceof Date) return d.toISOString();
      if (typeof d === 'string') return new Date(d).toISOString();
      return String(d);
    };
    const lower = formatDateTime(value.lower);
    const upper = formatDateTime(value.upper);
    return `${lowerBracket}"${lower}","${upper}"${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]"?([^,"]+)"?,"?([^\]"\)]+)"?[\]\)]/);
    if (!match) return { lower: new Date(), upper: new Date(), lowerInclusive, upperInclusive };
    
    return {
      lower: new Date(match[1]),
      upper: new Date(match[2]),
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);

/**
 * Timestamp with timezone range type
 * Usage: rangeDateTimeTz('schedule_range')
 */
export const rangeDateTimeTz = (name: string) => customType<{
  data: Range<Date | string>;
  driverData: string;
}>({
  dataType() {
    return 'tstzrange';
  },
  toDriver(value: Range<Date | string>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    // Handle both Date objects and ISO strings
    const formatDateTime = (d: Date | string) => {
      if (d instanceof Date) return d.toISOString();
      if (typeof d === 'string') return new Date(d).toISOString();
      return String(d);
    };
    const lower = formatDateTime(value.lower);
    const upper = formatDateTime(value.upper);
    return `${lowerBracket}"${lower}","${upper}"${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]"?([^,"]+)"?,"?([^\]"\)]+)"?[\]\)]/);
    if (!match) return { lower: new Date(), upper: new Date(), lowerInclusive, upperInclusive };
    
    return {
      lower: new Date(match[1]),
      upper: new Date(match[2]),
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);

/**
 * Double precision range type
 * Usage: rangeDouble('measurement_range')
 */
export const rangeDouble = rangeDecimal; // Alias for decimal range

/**
 * Time range type with timezone
 * Usage: rangeTimeTz('working_hours')
 */
export const rangeTimeTz = (name: string) => customType<{
  data: Range<string>;
  driverData: string;
}>({
  dataType() {
    return 'timetzrange';
  },
  toDriver(value: Range<string>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    return `${lowerBracket}${value.lower},${value.upper}${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]([^,]+),([^\]\)]+)[\]\)]/);
    if (!match) return { lower: '00:00:00', upper: '00:00:00', lowerInclusive, upperInclusive };
    
    return {
      lower: match[1],
      upper: match[2],
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);

/**
 * Time range type without timezone (no date)
 * Usage: rangeTime('working_hours')
 */
export const rangeTime = (name: string) => customType<{
  data: Range<string>;
  driverData: string;
}>({
  dataType() {
    return 'timerange';
  },
  toDriver(value: Range<string>) {
    const lowerBracket = value.lowerInclusive !== false ? '[' : '(';
    const upperBracket = value.upperInclusive !== false ? ']' : ')';
    return `${lowerBracket}${value.lower},${value.upper}${upperBracket}`;
  },
  fromDriver(value: string) {
    const lowerInclusive = value.startsWith('[');
    const upperInclusive = value.endsWith(']');
    const match = value.match(/[\[\(]([^,]+),([^\]\)]+)[\]\)]/);
    if (!match) return { lower: '00:00:00', upper: '00:00:00', lowerInclusive, upperInclusive };
    
    return {
      lower: match[1],
      upper: match[2],
      lowerInclusive,
      upperInclusive,
    };
  },
})(name);
