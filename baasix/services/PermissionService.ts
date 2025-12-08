import { db } from '../utils/db.js';
import { schemaManager } from '../utils/schemaManager.js';
import { FieldExpansionUtil } from '../utils/fieldExpansion.js';
import { resolveDynamicVariables } from '../utils/dynamicVariableResolver.js';
import { getCache } from '../utils/cache.js';
import { eq } from 'drizzle-orm';
import type { PermissionFilter, PermissionData } from '../types/index.js';

// Re-export types for backward compatibility
export type { PermissionFilter };

/**
 * Permission Service - Handles role-based access control
 *
 * Matches Sequelize implementation 1:1
 * 
 * Uses Redis/in-memory cache with infinite TTL for permissions
 */

export class PermissionService {
  constructor() {
    console.info("PermissionService instance created");
  }

  /**
   * Get cache instance
   */
  private getCache() {
    return getCache();
  }

  /**
   * Load permissions from database
   */
  async loadPermissions(role_Id?: string | number | null): Promise<void> {
    const cache = this.getCache();
    let permissions: any[];

    try {
      const PermissionTable = schemaManager.getTable('baasix_Permission');

      if (role_Id) {
        // Load permissions for specific role
        permissions = await db
          .select()
          .from(PermissionTable)
          .where(eq(PermissionTable.role_Id, role_Id));
      } else {
        // Load all permissions
        permissions = await db.select().from(PermissionTable);
      }

      if (!role_Id) {
        // Clear all permissions caches
        await cache.invalidateModel("permissions");
      }

      // Cache permissions by role
      for (const permission of permissions) {
        const cacheKey = `permissions:role:${permission.role_Id}`;
        const rolePermissions = (await cache.get(cacheKey)) || {};
        const collectionName = permission.collection;

        rolePermissions[collectionName] = rolePermissions[collectionName] || {};
        rolePermissions[collectionName][permission.action] = {
          fields: this.parseFields(permission.fields),
          conditions: permission.conditions || {},
          relConditions: permission.relConditions || {},
          defaultValues: permission.defaultValues || {},
        };

        // Use infinite TTL (-1) for permissions cache
        await cache.set(cacheKey, rolePermissions, -1);
      }
    } catch (error) {
      console.error('Error loading permissions:', error);
      // Initialize empty cache if table doesn't exist yet
      if (!role_Id) {
        await cache.invalidateModel("permissions");
      }
    }
  }

  /**
   * Parse fields string to array
   */
  private parseFields(fieldsString: string | string[] | null): string[] | null {
    if (!fieldsString) return null;

    // If fieldsString is array, return it as is
    if (Array.isArray(fieldsString)) return fieldsString;

    return fieldsString.split(',').map((f) => f.trim());
  }

  /**
   * Get permissions for a role
   */
  async getPermissions(role_Id: string | number): Promise<Record<string, Record<string, PermissionData>>> {
    const cache = this.getCache();
    const cacheKey = `permissions:role:${role_Id}`;
    return (await cache.get(cacheKey)) || {};
  }

  /**
   * Check if role can access collection with operation
   */
  async canAccess(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'read' | 'update' | 'delete',
    fields: string[] | null = null
  ): Promise<boolean> {
    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (!collectionPermissions || !collectionPermissions[operation]) {
      return false;
    }

    if (fields && collectionPermissions[operation].fields) {
      return this.checkFieldPermissions(fields, collectionPermissions[operation].fields);
    }

    if (fields) {
      const primaryKey = schemaManager.getPrimaryKey(collection);
      const requiredFields = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
      const allFields = [...new Set([...fields, ...requiredFields])];
      return this.checkFieldPermissions(allFields, collectionPermissions[operation].fields);
    }

    return true;
  }

  /**
   * Check if requested fields are allowed
   */
  private checkFieldPermissions(requestedFields: string[], allowedFields: string[] | null): boolean {
    if (!allowedFields || allowedFields.includes('*')) return true;

    for (const field of requestedFields) {
      if (!this.isFieldAllowed(field, allowedFields)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check if a single field is allowed
   */
  private isFieldAllowed(field: string, allowedFields: string[]): boolean {
    const fieldParts = field.split('.');

    for (const allowedField of allowedFields) {
      const allowedParts = allowedField.split('.');
      if (this.matchFieldPattern(fieldParts, allowedParts)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match field pattern with wildcards
   * Supports:
   * - * : matches exactly one level (e.g., "user.*" matches "user.name" but not "user.role.name")
   * - ** : matches any number of nested levels (e.g., "user.**" matches "user.name", "user.role.name", etc.)
   */
  private matchFieldPattern(fieldParts: string[], allowedParts: string[]): boolean {
    // Check for ** wildcard (matches any depth)
    const doubleStarIndex = allowedParts.indexOf('**');
    if (doubleStarIndex !== -1) {
      // ** can only be at the end of the pattern
      if (doubleStarIndex !== allowedParts.length - 1) {
        // Invalid pattern: ** must be the last part
        return false;
      }
      // Match all parts before **
      for (let i = 0; i < doubleStarIndex; i++) {
        if (allowedParts[i] === '*') continue;
        if (i >= fieldParts.length || allowedParts[i] !== fieldParts[i]) return false;
      }
      // ** matches any remaining parts (including none)
      return fieldParts.length >= doubleStarIndex;
    }

    // Original logic for single * wildcards
    if (allowedParts.length > fieldParts.length) return false;

    for (let i = 0; i < allowedParts.length; i++) {
      if (allowedParts[i] === '*') continue;
      if (allowedParts[i] !== fieldParts[i]) return false;
    }

    return (
      allowedParts[allowedParts.length - 1] === '*' ||
      allowedParts.length === fieldParts.length
    );
  }

  /**
   * Get filter conditions for a role and collection
   */
  async getFilter(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'read' | 'update' | 'delete',
    accountability: any
  ): Promise<PermissionFilter> {
    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (collectionPermissions && collectionPermissions[operation]) {
      const conditions = collectionPermissions[operation]?.conditions || {};
      const relConditions = collectionPermissions[operation]?.relConditions || {};

      // Resolve dynamic variables in permission conditions
      const resolvedConditions = await resolveDynamicVariables(conditions, accountability);
      const resolvedRelConditions = await resolveDynamicVariables(relConditions, accountability);

      return {
        conditions: resolvedConditions,
        relConditions: resolvedRelConditions,
      };
    }

    return {
      conditions: {},
      relConditions: {},
    };
  }

  /**
   * Get default values from permissions
   */
  async getDefaultValues(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'update',
    accountability: any
  ): Promise<Record<string, any>> {
    if (!role_Id || !collection || !operation || !accountability) {
      return {};
    }

    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (
      collectionPermissions &&
      collectionPermissions[operation] &&
      collectionPermissions[operation].defaultValues
    ) {
      return await resolveDynamicVariables(
        collectionPermissions[operation].defaultValues,
        accountability
      );
    }

    return {};
  }

  /**
   * Get allowed fields for a role and collection
   */
  async getAllowedFields(
    role_Id: string | number,
    collection: string,
    operation: 'create' | 'read' | 'update' | 'delete'
  ): Promise<string[] | null> {
    const permissions = await this.getPermissions(role_Id);
    const collectionPermissions = permissions[collection];

    if (collectionPermissions && collectionPermissions[operation]) {
      const fields = collectionPermissions[operation].fields;
      
      if (!fields) return null;
      if (fields.includes('*')) return ['*'];
      
      return FieldExpansionUtil.expandFields(fields, collection);
    }

    return null;
  }
}

// Create and export singleton instance
const permissionService = new PermissionService();
export { permissionService };
export default permissionService;