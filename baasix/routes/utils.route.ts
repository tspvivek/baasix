import { Express } from "express";
import { sortItems } from "../utils/sortUtils.js";

const registerEndpoint = (app: Express, context: any) => {

  /**
   * Sort items within a collection
   * This route supports moving an item before/after another item
   * Similar to Directus's sort functionality
   */
  app.post("/utils/sort/:collection", async (req, res, next) => {
    try {
      const { collection } = req.params;
      const { item, to } = req.body;

      // Use the sortItems utility function (handles validation and permission checks)
      const result = await sortItems({
        collection,
        item,
        to,
        accountability: req.accountability,
      });

      return res.status(200).json({
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "utils",
  handler: registerEndpoint,
};
