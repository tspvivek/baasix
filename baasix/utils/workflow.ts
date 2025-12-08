/**
 * Workflow Utility Functions
 *
 * Provides helper functions for workflow execution, role-based access control,
 * and workflow validation.
 *
 * Matches Sequelize workflow.js functionality with Drizzle ORM.
 */

import { APIError } from './errorHandler.js';
import type { Accountability, Workflow } from '../types/index.js';

// Re-export types for backward compatibility
export type { Accountability, Workflow };

/**
 * Lazy getter for ItemsService to avoid circular dependency
 */
let _ItemsService: any = null;
async function getItemsService() {
  if (!_ItemsService) {
    const module = await import('../services/ItemsService.js');
    _ItemsService = module.default || module.ItemsService;
  }
  return _ItemsService;
}

/**
 * Helper function to check if user has required role for workflow execution
 *
 * @param workflow - Workflow object with trigger_type and allowed_roles
 * @param accountability - User accountability object with role info
 * @returns True if user has access, false otherwise
 *
 * @example
 * const hasAccess = checkWorkflowRoleAccess(workflow, { role: { id: '1', name: 'administrator' } });
 * if (!hasAccess) {
 *   throw new APIError('No permission', 403);
 * }
 */
export const checkWorkflowRoleAccess = (
  workflow: Workflow,
  accountability?: Accountability | null
): boolean => {
  // Only skip role check for schedule trigger type
  // Apply to manual, hook, and webhook trigger types
  if (workflow.trigger_type === 'schedule') {
    return true;
  }

  // Check if user is administrator - administrators can execute all workflows
  if (accountability && accountability.role) {
    const roleName = typeof accountability.role === 'object' 
      ? accountability.role.name 
      : null;
    
    if (roleName === 'administrator') {
      return true;
    }
  }

  // Parse allowed_roles if it's a string (happens with raw queries)
  let allowedRoles = workflow.allowed_roles;
  if (typeof allowedRoles === 'string') {
    try {
      allowedRoles = JSON.parse(allowedRoles);
    } catch (e) {
      console.error('Failed to parse allowed_roles:', e);
      allowedRoles = [];
    }
  }

  // If allowed_roles is null, undefined, or empty array, allow all authenticated users
  if (!allowedRoles || (Array.isArray(allowedRoles) && allowedRoles.length === 0)) {
    return true;
  }

  // Check if user's role is in the allowed_roles array
  // accountability.role can be either a role ID (string) or a role object
  if (!accountability || !accountability.role) {
    return false;
  }

  // Extract role ID - handle both string and object formats
  const userRoleId = typeof accountability.role === 'object' 
    ? String(accountability.role.id)
    : String(accountability.role);

  // Ensure allowedRoles is an array and contains strings
  const rolesArray = Array.isArray(allowedRoles) 
    ? allowedRoles.map(r => String(r))
    : [];

  return rolesArray.includes(userRoleId);
};

/**
 * Fetch workflow from database with required fields for role checking
 * 
 * @param workflowId - Workflow ID
 * @param includeFlowData - Whether to include flow_data field (default: false)
 * @returns Workflow object
 * @throws APIError if workflow not found
 * 
 * @example
 * const workflow = await fetchWorkflowForExecution('workflow-id', true);
 * console.log(workflow.name, workflow.flow_data);
 */
export const fetchWorkflowForExecution = async (
  workflowId: string | number,
  includeFlowData: boolean = false
): Promise<Workflow> => {
  try {
    // Use ItemsService to fetch workflow (lazy getter to avoid circular dependency)
    const ItemsService = await getItemsService();
    const workflowService = new ItemsService('baasix_Workflow');
    
    // Define fields to fetch
    const fields = ['id', 'name', 'status', 'trigger_type', 'allowed_roles'];
    if (includeFlowData) {
      fields.push('flow_data', 'variables');
    }
    
    // Fetch workflow
    const result = await workflowService.readByQuery({
      filter: { id: workflowId },
      fields,
      limit: 1
    });

    if (!result.data || result.data.length === 0) {
      throw new APIError('Workflow not found', 404);
    }

    return result.data[0] as Workflow;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    console.error('[Workflow] Error fetching workflow:', error);
    throw new APIError('Failed to fetch workflow', 500);
  }
};

/**
 * Validate workflow is active and user has access
 * 
 * @param workflow - Workflow object
 * @param accountability - User accountability object
 * @throws APIError if validation fails (400 if not active, 403 if no permission)
 * 
 * @example
 * const workflow = await fetchWorkflowForExecution(id);
 * validateWorkflowAccess(workflow, req.accountability);
 * // If successful, workflow can be executed
 */
export const validateWorkflowAccess = (
  workflow: Workflow,
  accountability?: Accountability | null
): void => {
  // Check if workflow is active
  if (workflow.status !== 'active') {
    throw new APIError('Workflow is not active', 400);
  }

  // Check if user has role access
  if (!checkWorkflowRoleAccess(workflow, accountability)) {
    throw new APIError('You do not have permission to execute this workflow', 403);
  }
};

/**
 * Combined helper: Fetch and validate workflow in one call
 * 
 * @param workflowId - Workflow ID
 * @param accountability - User accountability object
 * @param includeFlowData - Whether to include flow_data field
 * @returns Validated workflow object ready for execution
 * @throws APIError if workflow not found, not active, or no permission
 * 
 * @example
 * const workflow = await fetchAndValidateWorkflow(id, req.accountability, true);
 * await workflowService.executeWorkflow(workflow);
 */
export const fetchAndValidateWorkflow = async (
  workflowId: string | number,
  accountability?: Accountability | null,
  includeFlowData: boolean = false
): Promise<Workflow> => {
  const workflow = await fetchWorkflowForExecution(workflowId, includeFlowData);
  validateWorkflowAccess(workflow, accountability);
  return workflow;
};

/**
 * Check if user can create/edit workflow with specific allowed_roles
 * 
 * @param allowedRoles - Array of role IDs that can execute the workflow
 * @param accountability - User accountability object
 * @returns True if user can set these allowed_roles
 * 
 * @example
 * const canSetRoles = canSetWorkflowRoles(['admin-role-id'], req.accountability);
 * if (!canSetRoles) {
 *   throw new APIError('Cannot create workflow with these roles', 403);
 * }
 */
export const canSetWorkflowRoles = (
  allowedRoles: string[] | null | undefined,
  accountability?: Accountability | null
): boolean => {
  // Administrators can set any roles
  if (accountability && accountability.role) {
    const roleName = typeof accountability.role === 'object' 
      ? accountability.role.name 
      : null;
    
    if (roleName === 'administrator') {
      return true;
    }
  }

  // If no roles specified (allow all), anyone can create
  if (!allowedRoles || allowedRoles.length === 0) {
    return true;
  }

  // User can only create workflows for their own role
  if (accountability && accountability.role) {
    const userRoleId = typeof accountability.role === 'object' 
      ? String(accountability.role.id)
      : String(accountability.role);
    
    // Check if user's role is included in allowed roles
    return allowedRoles.map(r => String(r)).includes(userRoleId);
  }

  return false;
};

// Export all functions
export default {
  checkWorkflowRoleAccess,
  fetchWorkflowForExecution,
  validateWorkflowAccess,
  fetchAndValidateWorkflow,
  canSetWorkflowRoles
};
