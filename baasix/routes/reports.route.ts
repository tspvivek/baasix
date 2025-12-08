import { Express } from "express";
import ReportService from "../services/ReportService.js";
import StatsService from "../services/StatsService.js";
import { schemaManager } from "../utils/schemaManager.js";
import { parseQueryParams } from "../utils/router.js";
import { APIError } from "../utils/errorHandler.js";

const registerEndpoint = (app: Express) => {
  const modelExistsMiddleware = (req: any, res: any, next: any) => {
    const modelName = req.params.collection;
    if (!schemaManager.modelExists(modelName)) {
      return next(new APIError(`Model ${modelName} not found`, 404));
    }
    next();
  };

  // Stats endpoint - GET method - handles multiple queries for different collections
  app.get("/reports/stats", async (req, res, next) => {
    try {
      const { stats } = req.query;

      if (!Array.isArray(stats) || stats.length === 0) {
        throw new APIError("stats array is required and must not be empty", 400);
      }

      // Validate that each stat has a collection
      for (const stat of stats as any[]) {
        if (!stat.collection) {
          throw new APIError("Each stats query must have a 'collection' property", 400);
        }
        if (!schemaManager.modelExists(stat.collection)) {
          throw new APIError(`Model ${stat.collection} not found`, 404);
        }
      }

      const statsService = new StatsService({
        accountability: req.accountability,
      });

      const result = await statsService.generateStats(stats as any);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Main report endpoint - GET method - uses ItemsService query structure
  app.get("/reports/:collection", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection } = req.params;
      const query = req.query ? parseQueryParams(req.query) : {};

      const reportService = new ReportService(collection, {
        accountability: req.accountability,
      });

      const result = await reportService.generateReport(query);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Stats endpoint - POST method - handles multiple queries for different collections
  app.post("/reports/stats", async (req, res, next) => {
    try {
      const { stats } = req.body;

      if (!Array.isArray(stats) || stats.length === 0) {
        throw new APIError("stats array is required and must not be empty", 400);
      }

      // Validate that each stat has a collection
      for (const stat of stats) {
        if (!stat.collection) {
          throw new APIError("Each stats query must have a 'collection' property", 400);
        }
        if (!schemaManager.modelExists(stat.collection)) {
          throw new APIError(`Model ${stat.collection} not found`, 404);
        }
      }

      const statsService = new StatsService({
        accountability: req.accountability,
      });

      const result = await statsService.generateStats(stats);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Main report endpoint - POST method - uses ItemsService query structure
  app.post("/reports/:collection", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection } = req.params;
      const query = req.body;

      const reportService = new ReportService(collection, {
        accountability: req.accountability,
      });

      const result = await reportService.generateReport(query);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "reports",
  handler: registerEndpoint,
};
