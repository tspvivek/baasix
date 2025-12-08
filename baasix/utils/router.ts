import fs from "fs";
import path from "path";
import { Express } from "express";
import type { RouteContext } from '../types/index.js';

export const loadRoutes = async (app: Express, context: RouteContext): Promise<void> => {
  const dirPath = path.join(process.cwd(), "extensions");

  if (!fs.existsSync(dirPath)) {
    console.warn(`Extensions directory not found: ${dirPath}`);
    return;
  }

  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = path.join(dirPath, file);

    if (fs.lstatSync(fullPath).isDirectory() && file.startsWith("baasix-endpoint")) {
      const indexPath = path.join(fullPath, "index.js");
      if (fs.existsSync(indexPath)) {
        try {
          // Use dynamic import for ES modules
          const routeModule = await import(indexPath);

          if (routeModule && typeof routeModule.default === "object") {
            routeModule.default.handler(app, context);
            console.info(`Loaded Extension Endpoint: ${routeModule.default.id}`);
          }
        } catch (error: any) {
          console.error(`Error loading extension ${file}:`, error.message);
        }
      }
    }
  }
};

export const loadSystemRoutes = async (app: Express, context: RouteContext): Promise<void> => {
  // Use process.cwd() to find routes - works in both development (baasix/routes) and production (dist/routes)
  // First try dist/routes (production), then baasix/routes (development)
  let dirPath = path.join(process.cwd(), "dist", "routes");
  if (!fs.existsSync(dirPath)) {
    dirPath = path.join(process.cwd(), "baasix", "routes");
  }

  if (!fs.existsSync(dirPath)) {
    console.warn(`Routes directory not found: ${dirPath}`);
    return;
  }

  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    // Only load .js files (TypeScript compiles .ts to .js)
    if (fs.lstatSync(fullPath).isFile() && file.endsWith(".js")) {
      try {
        // Use relative import path with .js extension
        const relativePath = `../routes/${file}`;
        const routeModule = await import(relativePath);

        if (routeModule && typeof routeModule.default === "object") {
          routeModule.default.handler(app, context);
          console.info(`Loaded System Route: ${routeModule.default.id}`);
        }
      } catch (error: any) {
        console.error(`Error loading route ${file}:`, error.message);
      }
    }
  }
};

// Helper function to parse query parameters
export const parseQueryParams = (query: Record<string, any>): Record<string, any> => {
  const { fields, sort, filter, limit, page, search, sortByRelevance, searchFields, aggregate, groupBy, relConditions } =
    query;

  return {
    fields: fields
      ? Array.isArray(fields)
        ? fields
        : fields.startsWith("[")
        ? JSON.parse(fields)
        : fields.split(",")
      : undefined,
    sort: sort ? (typeof sort === "string" ? JSON.parse(sort) : sort) : undefined,
    filter: filter ? (typeof filter === "string" ? JSON.parse(filter) : filter) : undefined,
    relConditions: relConditions ? (typeof relConditions === "string" ? JSON.parse(relConditions) : relConditions) : undefined,
    limit: limit ? parseInt(limit) : undefined,
    page: page ? parseInt(page) : undefined,
    search,
    sortByRelevance,
    searchFields: searchFields
      ? Array.isArray(searchFields)
        ? searchFields
        : searchFields.split(",")
      : undefined,
    aggregate: aggregate ? JSON.parse(aggregate) : undefined,
    groupBy: groupBy ? (Array.isArray(groupBy) ? groupBy : groupBy.split(",")) : undefined,
  };
};
