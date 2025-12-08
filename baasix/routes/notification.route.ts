import { Express } from "express";
import NotificationService from "../services/NotificationService.js";
import { APIError } from "../utils/errorHandler.js";
import { parseQueryParams } from "../utils/router.js";
import { adminOnly } from "../utils/auth.js";

const registerEndpoint = (app: Express) => {
  // Get user's notifications with pagination and filtering
  app.get("/notifications", async (req, res, next) => {
    try {
      if (!req.accountability?.user?.id) {
        throw new APIError("Authentication required", 401);
      }

      const notificationService = new NotificationService({
        accountability: req.accountability,
      });

      const query = parseQueryParams(req.query);

      let filter: any = {
        userId: req.accountability.user.id,
      };

      if (query.filter) {
        filter = { AND: [{ ...query.filter }, { userId: req.accountability.user.id }] };
      }
      query.filter = filter;

      const results = await notificationService.getUserNotifications(query);
      res.json(results);
    } catch (error) {
      next(error);
    }
  });

  // Get unread notifications count
  app.get("/notifications/unread/count", async (req, res, next) => {
    try {
      if (!req.accountability?.user?.id) {
        throw new APIError("Authentication required", 401);
      }

      const notificationService = new NotificationService({
        accountability: req.accountability,
      });

      const count = await notificationService.getUnreadCount(req.accountability.user.id);
      res.json({ count });
    } catch (error) {
      next(error);
    }
  });

  // Mark notifications as seen
  app.post("/notifications/mark-seen", async (req, res, next) => {
    try {
      if (!req.accountability?.user?.id) {
        throw new APIError("Authentication required", 401);
      }

      const { notificationIds } = req.body; // Optional array of specific notification IDs

      const notificationService = new NotificationService({
        accountability: req.accountability,
      });

      const updatedCount = await notificationService.markAsSeen(req.accountability.user.id, notificationIds);

      res.json({
        message: "Notifications marked as seen",
        count: updatedCount,
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete notifications
  app.delete("/notifications", async (req, res, next) => {
    try {
      if (!req.accountability?.user?.id) {
        throw new APIError("Authentication required", 401);
      }

      const { notificationIds } = req.body; // Optional array of specific notification IDs

      const notificationService = new NotificationService({
        accountability: req.accountability,
      });

      const deletedCount = await notificationService.deleteForUser(req.accountability.user.id, notificationIds);

      res.json({
        message: "Notifications deleted",
        count: deletedCount,
      });
    } catch (error) {
      next(error);
    }
  });

  // Send notifications (admin only)
  app.post("/notifications/send", adminOnly, async (req, res, next) => {
    try {
      const { type, title, message, data, userIds, tenant_Id } = req.body;

      const notificationService = new NotificationService({
        accountability: req.accountability,
      });

      const notificationIds = await notificationService.send({
        type,
        title,
        message,
        data,
        userIds,
        tenant_Id,
      });

      res.json({
        message: "Notifications sent successfully",
        notificationIds,
      });
    } catch (error) {
      next(error);
    }
  });

  // Cleanup old notifications (admin only)
  app.post("/notifications/cleanup", adminOnly, async (req, res, next) => {
    try {
      const { days = 30 } = req.body;

      const notificationService = new NotificationService({
        accountability: req.accountability,
      });

      const deletedCount = await notificationService.cleanupOldNotifications(days);

      res.json({
        message: "Old notifications cleaned up",
        count: deletedCount,
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "notifications",
  handler: registerEndpoint,
};
