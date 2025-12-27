import fs from "fs";
import path from "path";
import { Express } from "express";
import type { RouteContext } from '../types/index.js';
import { getBaasixPath, getProjectPath } from "./dirname.js";

export const loadRoutes = async (app: Express, context: RouteContext): Promise<void> => {
  // Extensions are in the user's project directory
  const dirPath = getProjectPath("extensions");

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
  // System routes are inside the package's routes directory
  const dirPath = getBaasixPath("routes");

  if (!fs.existsSync(dirPath)) {
    console.warn(`Routes directory not found: ${dirPath}`);
    return;
  }

  const files = fs.readdirSync(dirPath);

  // Determine if we're in test/dev mode (loading .ts) or production mode (loading .js)
  // Check for .ts files that are NOT .d.ts (declaration) files
  const isTestMode = files.some(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  const extension = isTestMode ? '.ts' : '.js';

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    // Load route files based on environment - skip .d.ts files
    if (fs.lstatSync(fullPath).isFile() && 
        file.endsWith(extension) && 
        file.includes('.route.') && 
        !file.endsWith('.d.ts')) {
      try {
        // Use relative import path
        const fileWithoutExt = file.replace(extension, '');
        const relativePath = `../routes/${fileWithoutExt}.js`;
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
