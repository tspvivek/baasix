/**
 * Tasks Service Types
 * Types for background task management
 */

/**
 * Task interface
 */
export interface Task {
  id: string | number;
  task_status: string;
  scheduled_time: Date;
  [key: string]: any;
}
