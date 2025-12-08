/**
 * Custom Types Index
 * Exports all custom Drizzle types for easy importing
 */

// PostGIS Geometry Types
export {
  point,
  lineString,
  polygon,
  multiPoint,
  multiLineString,
  multiPolygon,
  geometryCollection,
  geography,
  geometry,
} from './postgis.js';

// PostgreSQL Array Types
export {
  arrayInteger,
  arrayBigInt,
  arrayText,
  arrayVarchar,
  arrayUuid,
  arrayBoolean,
  arrayDecimal,
  arrayDouble,
  arrayDate,
  arrayDateTime,
  arrayDateTimeTz,
  arrayDateOnly,
  arrayTime,
  arrayTimeTz,
  arrayOf,
} from './arrays.js';

// PostgreSQL Range Types
export {
  type Range,
  rangeInteger,
  rangeBigInt,
  rangeDecimal,
  rangeDate,
  rangeDateTime,
  rangeDateTimeTz,
  rangeDouble,
  rangeTime,
  rangeTimeTz,
} from './ranges.js';
