/**
 * Spatial/Geo Utilities for PostGIS with Drizzle ORM
 * 
 * Provides helper functions for working with PostGIS geometry and geography types.
 * All functions return Drizzle SQL template literals for use in queries.
 * 
 * Requires PostGIS extension to be enabled in PostgreSQL.
 */

import { sql, SQL } from 'drizzle-orm';
import type { GeoJSONPoint, GeoJSONGeometry } from '../types/index.js';

// Re-export types for backward compatibility
export type { GeoJSONPoint, GeoJSONGeometry };

/**
 * Spatial utilities object
 */
const spatialUtils = {
  /**
   * Convert longitude/latitude to PostGIS Point geometry
   * @param longitude - Longitude coordinate
   * @param latitude - Latitude coordinate
   * @param srid - Spatial Reference System ID (default: 4326 for WGS84)
   * @returns SQL for creating a Point geometry
   * 
   * @example
   * ```typescript
   * const point = spatialUtils.pointToGeometry(-122.4194, 37.7749); // San Francisco
   * await db.insert(locations).values({
   *   name: 'San Francisco',
   *   location: point
   * });
   * ```
   */
  pointToGeometry(longitude: number, latitude: number, srid: number = 4326): SQL {
    return sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), ${srid})`;
  },

  /**
   * Convert GeoJSON object to PostGIS geometry
   * @param geoJSON - GeoJSON object
   * @returns SQL for creating geometry from GeoJSON
   * 
   * @example
   * ```typescript
   * const geom = spatialUtils.geoJSONToGeometry({
   *   type: 'Point',
   *   coordinates: [-122.4194, 37.7749]
   * });
   * ```
   */
  geoJSONToGeometry(geoJSON: GeoJSONGeometry): SQL {
    return sql`ST_GeomFromGeoJSON(${JSON.stringify(geoJSON)})`;
  },

  /**
   * Calculate distance between two geometries
   * @param geom1 - First geometry (column name or SQL)
   * @param geom2 - Second geometry (column name or SQL)
   * @param useGeography - Use geography for accurate earth-surface distance
   * @returns SQL for distance calculation
   * 
   * @example
   * ```typescript
   * const dist = spatialUtils.distance('location', anotherPoint, true);
   * const results = await db.select({ distance: dist }).from(locations);
   * ```
   */
  distance(geom1: string | SQL, geom2: string | SQL, useGeography: boolean = false): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    
    if (useGeography) {
      return sql`ST_Distance(${g1}::geography, ${g2}::geography)`;
    }
    return sql`ST_Distance(${g1}, ${g2})`;
  },

  /**
   * Check if two geometries are within a specified distance
   * @param geom1 - First geometry
   * @param geom2 - Second geometry
   * @param distance - Distance threshold in meters (for geography) or units (for geometry)
   * @param useGeography - Use geography for earth-surface distance
   * @returns SQL for distance check
   * 
   * @example
   * ```typescript
   * const nearby = spatialUtils.dwithin('location', myPoint, 1000, true); // Within 1km
   * const results = await db.select().from(locations).where(nearby);
   * ```
   */
  dwithin(geom1: string | SQL, geom2: string | SQL, distance: number, useGeography: boolean = false): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    
    if (useGeography) {
      return sql`ST_DWithin(${g1}::geography, ${g2}::geography, ${distance})`;
    }
    return sql`ST_DWithin(${g1}, ${g2}, ${distance})`;
  },

  /**
   * Check if first geometry is within second geometry
   * @param geom1 - Geometry to test
   * @param geom2 - Container geometry
   * @returns SQL for within check
   */
  within(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_Within(${g1}, ${g2})`;
  },

  /**
   * Check if first geometry contains second geometry
   * @param geom1 - Container geometry
   * @param geom2 - Geometry to test
   * @returns SQL for contains check
   */
  contains(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_Contains(${g1}, ${g2})`;
  },

  /**
   * Check if two geometries intersect
   * @param geom1 - First geometry
   * @param geom2 - Second geometry
   * @returns SQL for intersects check
   */
  intersects(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_Intersects(${g1}, ${g2})`;
  },

  /**
   * Create buffer around geometry
   * @param geom - Geometry to buffer
   * @param distance - Buffer distance
   * @param useGeography - Use geography for earth-surface buffering
   * @returns SQL for buffer operation
   * 
   * @example
   * ```typescript
   * const buffered = spatialUtils.buffer('location', 500, true); // 500m buffer
   * ```
   */
  buffer(geom: string | SQL, distance: number, useGeography: boolean = false): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    
    if (useGeography) {
      return sql`ST_Buffer(${g}::geography, ${distance})::geometry`;
    }
    return sql`ST_Buffer(${g}, ${distance})`;
  },

  /**
   * Calculate area of geometry
   * @param geom - Geometry
   * @param useGeography - Use geography for accurate earth-surface area
   * @returns SQL for area calculation
   */
  area(geom: string | SQL, useGeography: boolean = false): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    
    if (useGeography) {
      return sql`ST_Area(${g}::geography)`;
    }
    return sql`ST_Area(${g})`;
  },

  /**
   * Get centroid of geometry
   * @param geom - Geometry
   * @returns SQL for centroid calculation
   */
  centroid(geom: string | SQL): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_Centroid(${g})`;
  },

  /**
   * Convert geometry to GeoJSON
   * @param geom - Geometry
   * @returns SQL for GeoJSON conversion
   */
  asGeoJSON(geom: string | SQL): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_AsGeoJSON(${g})`;
  },

  /**
   * Union of two geometries
   * @param geom1 - First geometry
   * @param geom2 - Second geometry
   * @returns SQL for union operation
   */
  union(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_Union(${g1}, ${g2})`;
  },

  /**
   * Difference between two geometries
   * @param geom1 - First geometry
   * @param geom2 - Geometry to subtract
   * @returns SQL for difference operation
   */
  difference(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_Difference(${g1}, ${g2})`;
  },

  /**
   * Symmetric difference between two geometries
   * @param geom1 - First geometry
   * @param geom2 - Second geometry
   * @returns SQL for symmetric difference operation
   */
  symDifference(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_SymDifference(${g1}, ${g2})`;
  },

  /**
   * Convex hull of geometry
   * @param geom - Geometry
   * @returns SQL for convex hull
   */
  convexHull(geom: string | SQL): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_ConvexHull(${g})`;
  },

  /**
   * Transform geometry to different spatial reference system
   * @param geom - Geometry
   * @param toSRID - Target SRID
   * @returns SQL for transform operation
   */
  transform(geom: string | SQL, toSRID: number): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_Transform(${g}, ${toSRID})`;
  },

  /**
   * Find closest point on first geometry to second geometry
   * @param geom1 - First geometry
   * @param geom2 - Second geometry
   * @returns SQL for closest point
   */
  closestPoint(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_ClosestPoint(${g1}, ${g2})`;
  },

  /**
   * Longest line between two geometries
   * @param geom1 - First geometry
   * @param geom2 - Second geometry
   * @returns SQL for longest line
   */
  longestLine(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_LongestLine(${g1}, ${g2})`;
  },

  /**
   * Shortest line between two geometries
   * @param geom1 - First geometry
   * @param geom2 - Second geometry
   * @returns SQL for shortest line
   */
  shortestLine(geom1: string | SQL, geom2: string | SQL): SQL {
    const g1 = typeof geom1 === 'string' ? sql.raw(geom1) : geom1;
    const g2 = typeof geom2 === 'string' ? sql.raw(geom2) : geom2;
    return sql`ST_ShortestLine(${g1}, ${g2})`;
  },

  /**
   * Azimuth (angle) between two points
   * @param point1 - First point
   * @param point2 - Second point
   * @returns SQL for azimuth in radians
   */
  azimuth(point1: string | SQL, point2: string | SQL): SQL {
    const p1 = typeof point1 === 'string' ? sql.raw(point1) : point1;
    const p2 = typeof point2 === 'string' ? sql.raw(point2) : point2;
    return sql`ST_Azimuth(${p1}, ${p2})`;
  },

  /**
   * Check if geometry is valid
   * @param geom - Geometry
   * @returns SQL for validity check
   */
  isValid(geom: string | SQL): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_IsValid(${g})`;
  },

  /**
   * Attempt to make invalid geometry valid
   * @param geom - Geometry
   * @returns SQL for making geometry valid
   */
  makeValid(geom: string | SQL): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_MakeValid(${g})`;
  },

  /**
   * Simplify geometry
   * @param geom - Geometry
   * @param tolerance - Simplification tolerance
   * @returns SQL for simplification
   */
  simplify(geom: string | SQL, tolerance: number): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_Simplify(${g}, ${tolerance})`;
  },

  /**
   * Get bounding box of geometry
   * @param geom - Geometry
   * @returns SQL for bounding box (returns geometry)
   */
  envelope(geom: string | SQL): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    return sql`ST_Envelope(${g})`;
  },

  /**
   * Get X coordinate of point
   * @param point - Point geometry
   * @returns SQL for X coordinate
   */
  x(point: string | SQL): SQL {
    const p = typeof point === 'string' ? sql.raw(point) : point;
    return sql`ST_X(${p})`;
  },

  /**
   * Get Y coordinate of point
   * @param point - Point geometry
   * @returns SQL for Y coordinate
   */
  y(point: string | SQL): SQL {
    const p = typeof point === 'string' ? sql.raw(point) : point;
    return sql`ST_Y(${p})`;
  },

  /**
   * Get length of linestring or multi-linestring
   * @param geom - Geometry
   * @param useGeography - Use geography for earth-surface length
   * @returns SQL for length calculation
   */
  length(geom: string | SQL, useGeography: boolean = false): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    
    if (useGeography) {
      return sql`ST_Length(${g}::geography)`;
    }
    return sql`ST_Length(${g})`;
  },

  /**
   * Get perimeter of polygon
   * @param geom - Polygon geometry
   * @param useGeography - Use geography for earth-surface perimeter
   * @returns SQL for perimeter calculation
   */
  perimeter(geom: string | SQL, useGeography: boolean = false): SQL {
    const g = typeof geom === 'string' ? sql.raw(geom) : geom;
    
    if (useGeography) {
      return sql`ST_Perimeter(${g}::geography)`;
    }
    return sql`ST_Perimeter(${g})`;
  },
};

export default spatialUtils;

