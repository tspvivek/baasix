import ItemsService from "./ItemsService.js";
import type { Accountability, ReportQuery } from '../types/index.js';

class ReportService {
  private collection: string;
  private accountability: Accountability | undefined;
  private itemsService: ItemsService;

  constructor(collection: string, params: { accountability?: Accountability } = {}) {
    this.collection = collection;
    this.accountability = params?.accountability;
    this.itemsService = new ItemsService(collection, params);
  }

  async generateReport(query: ReportQuery = {}): Promise<any> {
    // Use ItemsService query structure directly
    const { fields = ["*"], filter = {}, sort = [], limit = -1, page = 1, aggregate = {}, groupBy = [] } = query;

    // Check if fields contain dot notation (relational fields)
    const hasRelationalFields = fields.some((field) => typeof field === "string" && field.includes(".") && field !== "*");

    // If no groupBy, just pass through to ItemsService
    if (groupBy.length === 0) {
      return await this.itemsService.readByQuery(query, false);
    }

    // If groupBy exists but no relational fields, pass through with groupBy
    if (groupBy.length > 0 && !hasRelationalFields) {
      return await this.itemsService.readByQuery(query, false);
    }

    // Two-step approach for grouped reports with relational fields
    return await this._generateGroupedReportWithRelatedFields(query);
  }

  private async _generateGroupedReportWithRelatedFields(query: ReportQuery): Promise<any> {
    const { fields = ["*"], filter = {}, sort = [], limit = -1, page = 1, aggregate = {}, groupBy = [] } = query;

    // Step 1: Get aggregated data with groupBy fields only
    const step1Query: ReportQuery = {
      fields: groupBy, // Only include groupBy fields
      filter: filter,
      aggregate: aggregate,
      groupBy: groupBy,
      limit: limit,
      page: page,
      sort: sort,
    };

    const aggregatedResult = await this.itemsService.readByQuery(step1Query, false);

    if (!aggregatedResult.data || aggregatedResult.data.length === 0) {
      return aggregatedResult;
    }

    // Step 2: Get related data using ItemsService with dot notation
    // Extract the groupBy field values to filter by
    const groupByField = groupBy[0]; // Assuming single groupBy field for now
    const groupByValues = aggregatedResult.data.map((row: any) => row[groupByField]).filter((val: any) => val != null);

    if (groupByValues.length === 0) {
      return aggregatedResult;
    }

    // Query with relational fields using dot notation
    const step2Query: ReportQuery = {
      fields: fields, // Use the original fields which may contain dot notation
      filter: {
        ...filter,
        [groupByField]: { in: groupByValues },
      },
      limit: -1,
    };

    const relatedResult = await this.itemsService.readByQuery(step2Query, false);

    // Merge the aggregated data with related data
    const enrichedData: any[] = [];

    for (const aggregatedRow of aggregatedResult.data) {
      // Find matching related data
      const relatedRow = relatedResult.data.find((row: any) => row[groupByField] === aggregatedRow[groupByField]);

      // Merge aggregated data with related data
      const mergedRow = {
        ...aggregatedRow,
        ...(relatedRow || {}),
      };

      enrichedData.push(mergedRow);
    }

    return {
      data: enrichedData,
      totalCount: aggregatedResult.totalCount,
    };
  }
}

export default ReportService;
