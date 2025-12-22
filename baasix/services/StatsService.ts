import ReportService from "./ReportService.js";
import type { Accountability, StatsQuery, StatsResult } from '../types/index.js';

class StatsService {
  private accountability: Accountability | undefined;

  constructor(params: { accountability?: Accountability } = {}) {
    this.accountability = params?.accountability;
  }

  async generateStats(statsQueries: StatsQuery[]): Promise<StatsResult> {
    if (!Array.isArray(statsQueries) || statsQueries.length === 0) {
      throw new Error("statsQueries must be a non-empty array");
    }

    const results: Record<string, any> = {};

    // Process stats queries sequentially - fail fast on permission errors
    for (const statsQuery of statsQueries) {
      const { name, query, collection } = statsQuery;

      if (!name) {
        throw new Error('Each stats query must have a "name" property');
      }

      if (!query) {
        throw new Error('Each stats query must have a "query" property');
      }

      if (!collection) {
        throw new Error('Each stats query must have a "collection" property');
      }

      // Create a new ReportService instance for each collection
      // Don't catch errors - let permission errors propagate up
      const reportService = new ReportService(collection, {
        accountability: this.accountability,
      });
      const result = await reportService.generateReport(query);
      results[name] = result;
    }

    return {
      data: results,
      totalStats: statsQueries.length,
      successfulStats: statsQueries.length,
    };
  }
}

export default StatsService;
