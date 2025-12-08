/**
 * Workflow Types
 * Centralized workflow type definitions
 */

/**
 * Workflow interface
 */
export interface Workflow {
  id: string | number;
  name: string;
  status: string;
  trigger_type: string;
  allowed_roles?: string[] | string | null;
  flow_data?: any;
  variables?: any;
}
