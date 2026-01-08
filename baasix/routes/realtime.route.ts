/**
 * Realtime Routes
 * 
 * API endpoints for managing PostgreSQL-based realtime subscriptions.
 * Allows enabling/disabling realtime on collections and checking status.
 * 
 * Realtime config is stored in the schema definition:
 * {
 *   "realtime": {
 *     "enabled": true,
 *     "actions": ["insert", "update", "delete"]
 *   }
 * }
 */

import { Express, Request, Response, NextFunction } from "express";
import realtimeService from "../services/RealtimeService.js";
import { adminOnly } from "../utils/auth.js";

const registerEndpoint = (app: Express) => {
  /**
   * GET /realtime/status
   * Get the current status of the realtime service
   */
  app.get("/realtime/status", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = realtimeService.getStatus();
      const config = await realtimeService.checkReplicationConfig();

      res.json({
        data: {
          ...status,
          replicationConfig: config
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /realtime/config
   * Check PostgreSQL replication configuration
   */
  app.get("/realtime/config", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await realtimeService.checkReplicationConfig();

      res.json({
        data: config
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /realtime/collections
   * Get list of collections with realtime enabled
   */
  app.get("/realtime/collections", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const collections = realtimeService.getEnabledCollections();

      res.json({
        data: collections
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /realtime/collections/:collection/enable
   * Enable realtime for a specific collection
   * 
   * Body:
   * - actions?: string[] - Actions to broadcast: ["insert", "update", "delete"] (default: all)
   * - replicaIdentityFull?: boolean - Set replica identity to FULL for old values on UPDATE/DELETE
   */
  app.post("/realtime/collections/:collection/enable", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { collection } = req.params;
      const { actions, replicaIdentityFull } = req.body;

      // Validate actions if provided
      const validActions = ['insert', 'update', 'delete'];
      const enabledActions = actions || validActions;
      
      for (const action of enabledActions) {
        if (!validActions.includes(action)) {
          res.status(400).json({
            error: `Invalid action: ${action}. Valid actions are: ${validActions.join(', ')}`
          });
          return;
        }
      }

      // Enable realtime for the collection with specified actions
      await realtimeService.enableCollection(collection, enabledActions);

      // Optionally set replica identity to FULL for old values
      if (replicaIdentityFull && realtimeService.isWalAvailable()) {
        await realtimeService.setReplicaIdentityFull(collection);
      }

      const config = realtimeService.getCollectionConfig(collection);

      res.json({
        data: {
          message: `Realtime enabled for collection: ${collection}`,
          collection,
          config,
          replicaIdentityFull: !!replicaIdentityFull,
          walAvailable: realtimeService.isWalAvailable()
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /realtime/collections/:collection/disable
   * Disable realtime for a specific collection
   */
  app.post("/realtime/collections/:collection/disable", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { collection } = req.params;

      await realtimeService.disableCollection(collection);

      res.json({
        data: {
          message: `Realtime disabled for collection: ${collection}`,
          collection
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /realtime/collections/:collection
   * Update realtime actions for a collection
   * 
   * Body:
   * - actions: string[] - Actions to broadcast: ["insert", "update", "delete"]
   */
  app.patch("/realtime/collections/:collection", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { collection } = req.params;
      const { actions } = req.body;

      if (!actions || !Array.isArray(actions)) {
        res.status(400).json({
          error: "actions is required and must be an array"
        });
        return;
      }

      // Validate actions
      const validActions = ['insert', 'update', 'delete'];
      for (const action of actions) {
        if (!validActions.includes(action)) {
          res.status(400).json({
            error: `Invalid action: ${action}. Valid actions are: ${validActions.join(', ')}`
          });
          return;
        }
      }

      await realtimeService.updateCollectionActions(collection, actions);
      const config = realtimeService.getCollectionConfig(collection);

      res.json({
        data: {
          message: `Realtime actions updated for collection: ${collection}`,
          collection,
          config
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /realtime/collections/:collection
   * Get realtime config for a specific collection
   */
  app.get("/realtime/collections/:collection", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { collection } = req.params;
      const config = realtimeService.getCollectionConfig(collection);

      res.json({
        data: {
          collection,
          enabled: !!config?.enabled,
          config: config || null
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /realtime/reload
   * Reload realtime configuration from database
   */
  app.post("/realtime/reload", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await realtimeService.reloadCollections();

      res.json({
        data: {
          message: "Realtime configuration reloaded",
          status: realtimeService.getStatus()
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /realtime/initialize
   * Manually initialize the realtime service (if not auto-started)
   */
  app.post("/realtime/initialize", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = realtimeService.getStatus();
      
      if (status.initialized) {
        res.json({
          data: {
            message: "Realtime service is already initialized",
            status
          }
        });
        return;
      }

      await realtimeService.initialize();
      await realtimeService.startConsuming();

      res.json({
        data: {
          message: "Realtime service initialized successfully",
          status: realtimeService.getStatus()
        }
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "realtime",
  handler: registerEndpoint,
};
