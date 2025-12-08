import ItemsService from "./ItemsService.js";
import { db } from "../utils/db.js";
import { schemaManager } from "../utils/schemaManager.js";
import { APIError } from "../utils/errorHandler.js";
import { eq, and, lt, sql, inArray } from "drizzle-orm";
import { invalidateEntireCache } from "./CacheService.js";
import type { NotificationOptions, Accountability } from '../types/index.js';

class NotificationService {
  private accountability?: Accountability;
  private itemsService: ItemsService;

  constructor(params: { accountability?: Accountability } = {}) {
    const { accountability } = params;
    this.accountability = accountability;
    this.itemsService = new ItemsService("baasix_Notification", { accountability });
  }

  /**
   * Send notifications to multiple users
   */
  async send(options: NotificationOptions): Promise<Array<string | number>> {
    const { type, title, message, data, userIds, tenant_Id } = options;

    if (!type || !title || !message || !Array.isArray(userIds) || userIds.length === 0) {
      throw new APIError("Invalid notification parameters", 400);
    }

    try {
      // Start a transaction
      return await db.transaction(async (tx) => {
        const notifications: Array<string | number> = [];

        // Create notifications for each user
        for (const userId of userIds) {
          const notificationData = {
            type,
            title,
            message,
            data,
            userId,
            seen: false,
            tenant_Id: tenant_Id || null,
          };

          // Use ItemsService to create notification with transaction
          // bypassPermissions: true since this is a system operation
          const itemsServiceWithTx = new ItemsService("baasix_Notification", {
            accountability: this.accountability,
          });
          
          const notificationId = await itemsServiceWithTx.createOne(notificationData, {
            bypassPermissions: true,
          });
          notifications.push(notificationId);
        }

        // Invalidate cache after transaction commits
        await invalidateEntireCache("baasix_Notification");
        
        return notifications;
      });
    } catch (error: any) {
      throw new APIError("Error sending notifications", 500, error.message);
    }
  }

  /**
   * Mark notifications as seen for a user
   */
  async markAsSeen(userId: string, notificationIds: string[] | null = null): Promise<number> {
    try {
      const notificationTable = schemaManager.getTable("baasix_Notification");

      let whereConditions;
      if (notificationIds && notificationIds.length > 0) {
        whereConditions = and(
          eq(notificationTable.userId, userId),
          eq(notificationTable.seen, false),
          inArray(notificationTable.id, notificationIds)
        );
      } else {
        whereConditions = and(
          eq(notificationTable.userId, userId),
          eq(notificationTable.seen, false)
        );
      }

      const result = await db
        .update(notificationTable)
        .set({ seen: true, seenAt: new Date() })
        .where(whereConditions);

      // Invalidate cache after update
      await invalidateEntireCache("baasix_Notification");

      return (result as any).rowCount || 0;
    } catch (error: any) {
      throw new APIError("Error marking notifications as seen", 500, error.message);
    }
  }

  /**
   * Delete notifications for a user
   */
  async deleteForUser(userId: string, notificationIds: string[] | null = null): Promise<number> {
    try {
      const notificationTable = schemaManager.getTable("baasix_Notification");

      let whereConditions;
      if (notificationIds && notificationIds.length > 0) {
        whereConditions = and(
          eq(notificationTable.userId, userId),
          inArray(notificationTable.id, notificationIds)
        );
      } else {
        whereConditions = eq(notificationTable.userId, userId);
      }

      const result = await db
        .delete(notificationTable)
        .where(whereConditions);

      // Invalidate cache after delete
      await invalidateEntireCache("baasix_Notification");

      return (result as any).rowCount || 0;
    } catch (error: any) {
      throw new APIError("Error deleting notifications", 500, error.message);
    }
  }

  /**
   * Get unread notifications count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      // Use ItemsService.readByQuery to count
      const result = await this.itemsService.readByQuery({
        filter: {
          userId: userId,
          seen: false,
        },
        limit: -1, // Get all to count
      });

      return result.data.length;
    } catch (error: any) {
      throw new APIError("Error getting unread count", 500, error.message);
    }
  }

  /**
   * Get user's notifications with pagination and filtering
   */
  async getUserNotifications(query: any = {}): Promise<any> {
    try {
      return await this.itemsService.readByQuery(query, true);
    } catch (error: any) {
      throw new APIError("Error fetching notifications", 500, error.message);
    }
  }

  /**
   * Delete old notifications based on age
   */
  async cleanupOldNotifications(days: number = 30): Promise<number> {
    try {
      const notificationTable = schemaManager.getTable("baasix_Notification");
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await db
        .delete(notificationTable)
        .where(lt(notificationTable.createdAt, cutoffDate));

      // Invalidate cache after cleanup
      await invalidateEntireCache("baasix_Notification");

      return (result as any).rowCount || 0;
    } catch (error: any) {
      throw new APIError("Error cleaning up old notifications", 500, error.message);
    }
  }
}

export default NotificationService;
