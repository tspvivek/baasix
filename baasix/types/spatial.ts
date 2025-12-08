/**
 * Spatial/GIS Types
 * Centralized spatial and geospatial type definitions
 */

/**
 * GeoJSON Point interface
 */
export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

/**
 * GeoJSON Geometry interface
 */
export interface GeoJSONGeometry {
  type: string;
  coordinates: any;
}
