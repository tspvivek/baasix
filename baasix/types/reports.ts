/**
 * Report Service Types
 * Types for report generation and statistics
 */

/**
 * Report query interface
 */
export interface ReportQuery {
  fields?: string[];
  filter?: Record<string, any>;
  sort?: string[];
  limit?: number;
  page?: number;
  aggregate?: Record<string, any>;
  groupBy?: string[];
}
