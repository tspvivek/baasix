import { Express } from "express";
import ItemsService from "../services/ItemsService.js";
import { schemaManager } from "../utils/schemaManager.js";
import { parseQueryParams } from "../utils/router.js";
import { APIError } from "../utils/errorHandler.js";
import fileUpload from "express-fileupload";
import { parse } from "csv-parse/sync";
import { validateFileType, processCSVSpecificFields, processJSONSpecificFields } from "../utils/importUtils.js";
import { invalidateCorsCache } from "../app.js";
import { db } from "../utils/db.js";
import {
  modelExistsMiddleware,
  invalidateSettingsCache,
  invalidateSettingsCacheAfterImport,
  getImportAccountability,
} from "../utils/common.js";

const registerEndpoint = (app: Express) => {

  // GET all items
  app.get("/items/:collection", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection } = req.params;
      const query = parseQueryParams(req.query);

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      const result = await itemsService.readByQuery(query);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // POST create multiple items - MUST be before /:id routes
  app.post("/items/:collection/bulk", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection } = req.params;
      const items = req.body;

      if (!Array.isArray(items)) {
        return next(new APIError("Request body must be an array", 400));
      }

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      const newItemIds = await itemsService.createMany(items);

      res.status(201).json({ data: newItemIds });
    } catch (error) {
      next(error);
    }
  });

  // PATCH update multiple items - MUST be before /:id routes
  app.patch("/items/:collection/bulk", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection } = req.params;
      const updates = req.body;

      if (!Array.isArray(updates)) {
        return next(new APIError("Request body must be an array", 400));
      }

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      // Use updateMany for transactional safety - all updates succeed or all fail
      // After hooks (emails, third-party calls) only execute after successful commit
      const results = await itemsService.updateMany(updates);

      res.json({ data: results });
    } catch (error) {
      next(error);
    }
  });

  // DELETE multiple items - MUST be before /:id routes
  app.delete("/items/:collection/bulk", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection } = req.params;
      const ids = req.body;

      if (!Array.isArray(ids)) {
        return next(new APIError("Request body must be an array of IDs", 400));
      }

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      // Use deleteMany for transactional safety - all deletes succeed or all fail
      // After hooks (emails, third-party calls) only execute after successful commit
      await itemsService.deleteMany(ids);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // GET single item
  app.get("/items/:collection/:id", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection, id } = req.params;
      const query = parseQueryParams(req.query);

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      const item = await itemsService.readOne(id, query);

      res.json({ data: item });
    } catch (error) {
      next(error);
    }
  });

  // POST create item
  app.post("/items/:collection", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection } = req.params;
      const data = req.body;

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      const newItemId = await itemsService.createOne(data);

      // Invalidate settings cache if needed
      if (collection === "baasix_Settings") {
        const createdItem = await itemsService.readOne(newItemId);
        await invalidateSettingsCache(createdItem, invalidateCorsCache);
      }

      res.status(201).json({ data: { id: newItemId } });
    } catch (error) {
      next(error);
    }
  });

  // PATCH update item
  app.patch("/items/:collection/:id", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection, id } = req.params;
      const data = req.body;

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      const updatedItemId = await itemsService.updateOne(id, data);

      // Invalidate settings cache if needed
      if (collection === "baasix_Settings") {
        const updatedItem = await itemsService.readOne(updatedItemId);
        await invalidateSettingsCache(updatedItem, invalidateCorsCache);
      }

      res.json({ data: { id: updatedItemId } });
    } catch (error) {
      next(error);
    }
  });

  // DELETE item
  app.delete("/items/:collection/:id", modelExistsMiddleware, async (req, res, next) => {
    try {
      const { collection, id } = req.params;

      const itemsService = new ItemsService(collection, {
        accountability: req.accountability as any,
      });

      // Get item before deleting for cache invalidation
      let itemToDelete = null;
      if (collection === "baasix_Settings") {
        try {
          itemToDelete = await itemsService.readOne(id);
        } catch (error: any) {
          console.log("Could not read item before delete:", error.message);
        }
      }

      const deletedItemId = await itemsService.deleteOne(id);

      // Invalidate settings cache if needed
      if (collection === "baasix_Settings" && itemToDelete) {
        await invalidateSettingsCache(itemToDelete, invalidateCorsCache);
      }

      res.json({ data: { id: deletedItemId } });
    } catch (error) {
      next(error);
    }
  });

  // Import CSV file
  app.post(
    "/items/:collection/import-csv",
    modelExistsMiddleware,
    fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }),
    async (req, res, next) => {
      try {
        const { collection } = req.params;

        // Validate file exists and type
        const csvFile = validateFileType((req as any).files?.csvFile, [".csv"], ["text/csv"], "CSV");

        // Handle tenant parameter based on user role and collection tenant support
        const accountability = getImportAccountability(req, collection);

        const itemsService = new ItemsService(collection, {
          accountability: accountability as any,
        });

        // Parse CSV data
        let csvData;
        try {
          csvData = parse(csvFile.data.toString(), {
            columns: true,
            skip_empty_lines: true,
            trim: true,
          });
        } catch (parseError: any) {
          throw new APIError(`Invalid CSV format: ${parseError.message}`, 400);
        }

        if (!csvData || csvData.length === 0) {
          throw new APIError("CSV file is empty or has no valid data", 400);
        }

        // Create a transaction for the entire import
        const results = {
          imported: 0,
          failed: 0,
          errors: [] as any[],
        };

        await db.transaction(async (tx) => {
          // Process each row
          for (let i = 0; i < csvData.length; i++) {
            try {
              const row = csvData[i];

              // Process fields using CSV-specific processing
              const table = schemaManager.getTable(collection);
              const processedRow = processCSVSpecificFields(row, table);

              // Create the item using ItemsService with transaction
              await itemsService.createOne(processedRow, {
                transaction: tx as any,
                bypassPermissions: false,
              });

              results.imported++;
            } catch (itemError: any) {
              results.failed++;
              results.errors.push({
                row: i + 1,
                data: csvData[i],
                error: itemError.message,
              });

              console.error(`Error importing row ${i + 1}:`, itemError.message);
            }
          }

          // If there were any failures, rollback the transaction
          if (results.failed > 0) {
            throw new APIError(
              `Import failed. ${results.failed} rows had errors. Transaction rolled back.`,
              400,
              { results }
            );
          }
        });

        // Invalidate settings cache if baasix_Settings was imported
        if (collection === "baasix_Settings") {
          await invalidateSettingsCacheAfterImport();
        }

        res.json({
          success: true,
          message: `Successfully imported ${results.imported} items`,
          results,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // Import JSON file
  app.post(
    "/items/:collection/import-json",
    modelExistsMiddleware,
    fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }),
    async (req, res, next) => {
      try {
        const { collection } = req.params;

        // Validate file exists and type
        const jsonFile = validateFileType((req as any).files?.jsonFile, [".json"], ["application/json"], "JSON");

        // Handle tenant parameter based on user role and collection tenant support
        const accountability = getImportAccountability(req, collection);

        const itemsService = new ItemsService(collection, {
          accountability: accountability as any,
        });

        // Parse JSON data
        let jsonData;
        try {
          const fileContent = jsonFile.data.toString();
          jsonData = JSON.parse(fileContent);
        } catch (parseError: any) {
          throw new APIError(`Invalid JSON format: ${parseError.message}`, 400);
        }

        // Ensure data is an array
        if (!Array.isArray(jsonData)) {
          throw new APIError("JSON file must contain an array of objects", 400);
        }

        if (jsonData.length === 0) {
          throw new APIError("JSON file is empty or has no valid data", 400);
        }

        // Create a transaction for the entire import
        const results = {
          imported: 0,
          failed: 0,
          errors: [] as any[],
        };

        await db.transaction(async (tx) => {
          // Process each item
          for (let i = 0; i < jsonData.length; i++) {
            try {
              const item = jsonData[i];

              // Validate item is an object
              if (typeof item !== "object" || item === null) {
                throw new Error(`Item at index ${i} must be an object`);
              }

              // Process fields using JSON-specific processing
              const table = schemaManager.getTable(collection);
              const processedItem = processJSONSpecificFields(item, table);

              // Create the item using ItemsService with transaction
              await itemsService.createOne(processedItem, {
                transaction: tx as any,
                bypassPermissions: false,
              });

              results.imported++;
            } catch (itemError: any) {
              results.failed++;
              results.errors.push({
                item: i + 1,
                data: jsonData[i],
                error: itemError.message,
              });

              console.error(`Error importing item ${i + 1}:`, itemError.message);
            }
          }

          // If there were any failures, rollback the transaction
          if (results.failed > 0) {
            throw new APIError(
              `Import failed. ${results.failed} items had errors. Transaction rolled back.`,
              400,
              { results }
            );
          }
        });

        // Invalidate settings cache if baasix_Settings was imported
        if (collection === "baasix_Settings") {
          await invalidateSettingsCacheAfterImport();
        }

        res.json({
          success: true,
          message: `Successfully imported ${results.imported} items`,
          results,
        });
      } catch (error) {
        next(error);
      }
    }
  );
};

export default {
  id: "items",
  handler: registerEndpoint,
};
