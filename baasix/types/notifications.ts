/**
 * Notification Service Types
 * Types for notification system
 */

/**
 * Options for sending notifications
 */
export interface NotificationOptions {
  type: string;
  title: string;
  message: string;
  data?: any;
  userIds: string[];
  tenant_Id?: string;
}
