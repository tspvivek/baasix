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

    // Process all stats queries in parallel
    const promises = statsQueries.map(async (statsQuery) => {
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

      try {
        // Create a new ReportService instance for each collection
        const reportService = new ReportService(collection, {
          accountability: this.accountability,
        });
        const result = await reportService.generateReport(query);
        return { name, result };
      } catch (error: any) {
        return { name, error: error.message };
      }
    });

    const statsResults = await Promise.all(promises);

    // Organize results by name
    statsResults.forEach(({ name, result, error }) => {
      if (error) {
        results[name] = { error };
      } else {
        results[name] = result;
      }
    });

    const successfulCount = statsResults.filter((r) => !r.error).length;

    return {
      data: results,
      totalStats: statsQueries.length,
      successfulStats: successfulCount,
    };
  }
}

export default StatsService;
