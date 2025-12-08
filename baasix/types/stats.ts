/**
 * Stats Service Types
 * Types for statistics generation
 */

/**
 * Stats query interface
 */
export interface StatsQuery {
  name: string;
  query: Record<string, any>;
  collection: string;
}

/**
 * Stats result interface
 */
export interface StatsResult {
  data: Record<string, any>;
  totalStats: number;
  successfulStats: number;
}
