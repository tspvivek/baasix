/**
 * Custom PostGIS geometry types for Drizzle ORM
 * Provides type-safe PostGIS geometry column definitions
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * Point - Represents a single point in 2D space
 * Usage: point('location')
 */
export const point = (name: string, srid: number = 4326) => customType<{
  data: { x: number; y: number } | { type: string; coordinates: number[] } | string;
  driverData: string;
}>({
  dataType() {
    return `geometry(Point, ${srid})`;
  },
  toDriver(value) {
    if (typeof value === 'string') return value;
    // Handle GeoJSON format
    if ('type' in value && value.type === 'Point' && 'coordinates' in value) {
      return `SRID=${srid};POINT(${value.coordinates[0]} ${value.coordinates[1]})`;
    }
    // Handle {x, y} format
    return `SRID=${srid};POINT(${(value as any).x} ${(value as any).y})`;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * LineString - Represents a line in 2D space
 * Usage: lineString('route')
 */
export const lineString = (name: string, srid: number = 4326) => customType<{
  data: Array<{ x: number; y: number }> | string;
  driverData: string;
}>({
  dataType() {
    return `geometry(LineString, ${srid})`;
  },
  toDriver(value) {
    if (typeof value === 'string') return value;
    const points = value.map(p => `${p.x} ${p.y}`).join(',');
    return `SRID=${srid};LINESTRING(${points})`;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * Polygon - Represents a polygon in 2D space
 * Usage: polygon('boundary')
 */
export const polygon = (name: string, srid: number = 4326) => customType<{
  data: Array<Array<{ x: number; y: number }>> | { type: string; coordinates: number[][][] } | string;
  driverData: string;
}>({
  dataType() {
    return `geometry(Polygon, ${srid})`;
  },
  toDriver(value) {
    if (typeof value === 'string') return value;
    // Handle GeoJSON format
    if ('type' in value && value.type === 'Polygon' && 'coordinates' in value) {
      const rings = value.coordinates.map(ring =>
        '(' + ring.map(coord => `${coord[0]} ${coord[1]}`).join(',') + ')'
      ).join(',');
      return `SRID=${srid};POLYGON(${rings})`;
    }
    // Handle array of {x, y} format
    const rings = (value as any).map((ring: any) =>
      '(' + ring.map((p: any) => `${p.x} ${p.y}`).join(',') + ')'
    ).join(',');
    return `SRID=${srid};POLYGON(${rings})`;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * MultiPoint - Represents multiple points
 * Usage: multiPoint('locations')
 */
export const multiPoint = (name: string, srid: number = 4326) => customType<{
  data: Array<{ x: number; y: number }> | string;
  driverData: string;
}>({
  dataType() {
    return `geometry(MultiPoint, ${srid})`;
  },
  toDriver(value) {
    if (typeof value === 'string') return value;
    const points = value.map(p => `(${p.x} ${p.y})`).join(',');
    return `SRID=${srid};MULTIPOINT(${points})`;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * MultiLineString - Represents multiple line strings
 * Usage: multiLineString('routes')
 */
export const multiLineString = (name: string, srid: number = 4326) => customType<{
  data: Array<Array<{ x: number; y: number }>> | string;
  driverData: string;
}>({
  dataType() {
    return `geometry(MultiLineString, ${srid})`;
  },
  toDriver(value) {
    if (typeof value === 'string') return value;
    const lines = value.map(line =>
      '(' + line.map(p => `${p.x} ${p.y}`).join(',') + ')'
    ).join(',');
    return `SRID=${srid};MULTILINESTRING(${lines})`;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * MultiPolygon - Represents multiple polygons
 * Usage: multiPolygon('areas')
 */
export const multiPolygon = (name: string, srid: number = 4326) => customType<{
  data: Array<Array<Array<{ x: number; y: number }>>> | string;
  driverData: string;
}>({
  dataType() {
    return `geometry(MultiPolygon, ${srid})`;
  },
  toDriver(value) {
    if (typeof value === 'string') return value;
    const polygons = value.map(polygon =>
      '(' + polygon.map(ring =>
        '(' + ring.map(p => `${p.x} ${p.y}`).join(',') + ')'
      ).join(',') + ')'
    ).join(',');
    return `SRID=${srid};MULTIPOLYGON(${polygons})`;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * GeometryCollection - Represents a collection of geometries
 * Usage: geometryCollection('mixed')
 */
export const geometryCollection = (name: string, srid: number = 4326) => customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return `geometry(GeometryCollection, ${srid})`;
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * Geography - Represents geographic data (uses Earth's spheroid)
 * Usage: geography('location')
 */
export const geography = (name: string, geographyType: string = 'Point', srid: number = 4326) => customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return `geography(${geographyType}, ${srid})`;
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return value;
  },
})(name);

/**
 * Generic geometry type for flexibility
 * Usage: geometry('geom', 'Point', 4326)
 */
export const geometry = (name: string, geometryType?: string, srid: number = 4326) => customType<{
  data: any;
  driverData: string;
}>({
  dataType() {
    if (geometryType) {
      return `geometry(${geometryType}, ${srid})`;
    }
    return `geometry`;
  },
  toDriver(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  },
  fromDriver(value) {
    return value;
  },
})(name);
