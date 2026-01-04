/**
 * Custom PostGIS geometry types for Drizzle ORM
 * Provides type-safe PostGIS geometry column definitions
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * Parse WKB (Well-Known Binary) hex string to GeoJSON
 * Supports Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon, GeometryCollection
 */
function parseWKB(wkbHex: unknown): any {
  // Handle null/undefined
  if (wkbHex == null) return null;
  
  // Already parsed (object)
  if (typeof wkbHex === 'object') return wkbHex;
  
  // Not a string
  if (typeof wkbHex !== 'string') return wkbHex;
  
  // Empty string
  if (wkbHex === '') return null;
  
  try {
    // Check if it's already GeoJSON (starts with {)
    if (wkbHex.startsWith('{')) {
      return JSON.parse(wkbHex);
    }
    
    // Parse WKB hex string
    const buffer = Buffer.from(wkbHex, 'hex');
    let offset = 0;
    
    // Read byte order (1 = little endian, 0 = big endian)
    const byteOrder = buffer.readUInt8(offset);
    offset += 1;
    const littleEndian = byteOrder === 1;
    
    // Read geometry type (with possible SRID flag)
    let geomType = littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    offset += 4;
    
    // Check for SRID flag (0x20000000)
    const hasSRID = (geomType & 0x20000000) !== 0;
    if (hasSRID) {
      geomType = geomType & 0x1FFFFFFF; // Remove SRID flag
      offset += 4; // Skip SRID bytes
    }
    
    // Parse based on geometry type
    const readDouble = () => {
      const val = littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);
      offset += 8;
      return val;
    };
    
    const readUInt32 = () => {
      const val = littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
      offset += 4;
      return val;
    };
    
    const readPoint = (): [number, number] => {
      const x = readDouble();
      const y = readDouble();
      // PostGIS WKB stores as [x, y] which is [longitude, latitude]
      // GeoJSON also expects [longitude, latitude], so no swap needed
      return [x, y];
    };
    
    const readLinearRing = (): [number, number][] => {
      const numPoints = readUInt32();
      const points: [number, number][] = [];
      for (let i = 0; i < numPoints; i++) {
        points.push(readPoint());
      }
      return points;
    };
    
    switch (geomType) {
      case 1: // Point
        return {
          type: 'Point',
          coordinates: readPoint()
        };
        
      case 2: // LineString
        return {
          type: 'LineString',
          coordinates: readLinearRing()
        };
        
      case 3: // Polygon
        const numRings = readUInt32();
        const rings: [number, number][][] = [];
        for (let i = 0; i < numRings; i++) {
          rings.push(readLinearRing());
        }
        return {
          type: 'Polygon',
          coordinates: rings
        };
        
      case 4: // MultiPoint
        const numPoints = readUInt32();
        const points: [number, number][] = [];
        for (let i = 0; i < numPoints; i++) {
          // Each point is a full geometry with header
          offset += 5; // Skip byte order + type
          if (hasSRID) offset += 4;
          points.push(readPoint());
        }
        return {
          type: 'MultiPoint',
          coordinates: points
        };
        
      case 5: // MultiLineString
        const numLines = readUInt32();
        const lines: [number, number][][] = [];
        for (let i = 0; i < numLines; i++) {
          offset += 5; // Skip header
          if (hasSRID) offset += 4;
          lines.push(readLinearRing());
        }
        return {
          type: 'MultiLineString',
          coordinates: lines
        };
        
      case 6: // MultiPolygon
        const numPolygons = readUInt32();
        const polygons: [number, number][][][] = [];
        for (let i = 0; i < numPolygons; i++) {
          offset += 5; // Skip header
          if (hasSRID) offset += 4;
          const polyRings = readUInt32();
          const polyCoords: [number, number][][] = [];
          for (let j = 0; j < polyRings; j++) {
            polyCoords.push(readLinearRing());
          }
          polygons.push(polyCoords);
        }
        return {
          type: 'MultiPolygon',
          coordinates: polygons
        };
        
      default:
        // Unknown type, return raw hex
        return wkbHex;
    }
  } catch (e) {
    // If parsing fails, return the original value
    console.warn('[PostGIS] Failed to parse WKB:', e);
    return wkbHex;
  }
}

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
    return parseWKB(value);
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
    return parseWKB(value);
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
    return parseWKB(value);
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
    return parseWKB(value);
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
    return parseWKB(value);
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
    return parseWKB(value);
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
    return parseWKB(value);
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
    return parseWKB(value);
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
    return parseWKB(value);
  },
})(name);
