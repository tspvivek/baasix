/**
 * Seed Types
 * Centralized seed data type definitions
 */

/**
 * Seed data interface
 */
export interface SeedData {
  collection: string;
  data: Record<string, any> | Record<string, any>[];
  clearBefore?: boolean; // Clear existing data before seeding
  skipDuplicates?: boolean; // Skip if data already exists (check by unique fields)
}

/**
 * Seed result interface
 */
export interface SeedResult {
  collection: string;
  created: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ item: any; error: string }>;
}
