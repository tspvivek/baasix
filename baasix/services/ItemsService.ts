import { and, eq, inArray, sql, SQL, asc, desc } from 'drizzle-orm';
import { PgTable, alias } from 'drizzle-orm/pg-core';
import argon2 from 'argon2';
import { APIError } from '../utils/errorHandler.js';
import { db, createTransaction, Transaction, getCacheService } from '../utils/db.js';
import { schemaManager } from '../utils/schemaManager.js';
import { hooksManager } from './HooksManager.js';
import env from '../utils/env.js';
import { permissionService } from './PermissionService.js';
import { resolveDynamicVariables } from '../utils/dynamicVariableResolver.js';
import {
  drizzleWhere,
  combineFilters,
  applyPagination,
  applyFullTextSearch,
  FilterObject
} from '../utils/queryBuilder.js';
import { drizzleOrder } from '../utils/orderUtils.js';
import {
  expandFieldsWithIncludes,
  buildSelectWithJoins,
  loadSeparateRelations,
  nestJoinedRelations,
  hasSeparateQueries
} from '../utils/relationLoader.js';
import {
  processRelationalData,
  handleHasManyRelationship,
  handleM2MRelationship,
  handleM2ARelationship,
  handleRelatedRecordsBeforeDelete,
  validateRelationalData,
  resolveCircularDependencies,
  processDeferredFields
} from '../utils/relationUtils.js';
import { resolveRelationPath } from '../utils/relationPathResolver.js';
import type {
  ProcessedInclude,
  IncludeConfig,
  RelationalResult,
  QueryOptions as BaseQueryOptions,
  ServiceParams as BaseServiceParams,
  OperationOptions,
  ReadResult
} from '../types/index.js';

import { shouldEnforceTenantContext, validateTenantContext, buildTenantFilter } from '../utils/tenantUtils.js';
import {
  buildAggregateAttributes,
  buildGroupByExpressions} from '../utils/aggregationUtils.js';
import { softDelete, restore } from '../plugins/softDelete.js';

// Re-export other types as-is
export type QueryOptions = BaseQueryOptions;
export type ServiceParams = BaseServiceParams;
export type { ReadResult, OperationOptions };

/**
 * ItemsService - Core CRUD service for all collections
 *
 * Provides:
 * - Read operations with filters, sorting, pagination, includes
 * - Create/Update/Delete operations with relation handling
 * - Permission enforcement and field-level security
 * - Multi-tenancy support
 * - Lifecycle hooks integration
 * - Soft-delete handling
 */
export class ItemsService {
  private collection: string;
  private accountability?: ServiceParams['accountability'];
  private tenant?: string | number;
  private table: PgTable;
  private primaryKey: string;
  private isMultiTenant: boolean;

  constructor(collection: string, params: ServiceParams = {}) {
    this.collection = collection;
    this.accountability = params.accountability;
    this.tenant = params.tenant;

    // Get table and schema info from schema manager
    this.table = schemaManager.getTable(collection);
    this.primaryKey = schemaManager.getPrimaryKey(collection);
    this.isMultiTenant = env.get('MULTI_TENANT') === 'true';

    // Debug: log table columns
    if (collection === 'products') {
      console.log(`[ItemsService.constructor] Products table columns:`, Object.keys(this.table).filter(k => !k.startsWith('_')));
    }
  }

  /**
   * Get primary key column from table (with type safety)
   */
  private getPrimaryKeyColumn(): any {
    return (this.table as any)[this.primaryKey];
  }

  /**
   * Parse ID to correct type (string or number)
   */
  private parseId(id: string | number): string | number {
    return isNaN(Number(id)) ? id : parseInt(String(id));
  }

  /**
   * Extract all table names involved in a query (including relations)
   * This is CRITICAL for proper cache invalidation
   */
  private extractAllTables(includes?: IncludeConfig[]): string[] {
    const tables = [this.collection]; // Always include main table

    if (!includes || includes.length === 0) {
      return tables;
    }

    for (const include of includes) {
      // Get the relation definition
      const relationDef = schemaManager.getRelation(this.collection, include.relation);

      if (!relationDef) {
        console.warn(`[ItemsService.extractAllTables] Relation not found: ${this.collection}.${include.relation}`);
        continue;
      }

      // Add the related table
      if (relationDef.relatedCollection) {
        tables.push(relationDef.relatedCollection);
      }

      // For M2M relations, add the junction table
      if (relationDef.type === 'M2M' && relationDef.junctionTable) {
        tables.push(relationDef.junctionTable);
      }

      // For M2A (polymorphic) relations, add all possible related collections
      if (relationDef.type === 'M2A' && relationDef.relatedCollections) {
        tables.push(...relationDef.relatedCollections);
      }

      // Recursively handle nested includes
      if (include.include && include.include.length > 0) {
        // Create a temporary service for the related collection to extract its tables
        try {
          const relatedService = new ItemsService(relationDef.relatedCollection, {
            accountability: this.accountability,
            tenant: this.tenant
          });
          const nestedTables = relatedService.extractAllTables(include.include);
          tables.push(...nestedTables);
        } catch (error) {
          console.warn(`[ItemsService.extractAllTables] Error extracting nested tables:`, error);
        }
      }
    }

    // Return unique table names only
    return [...new Set(tables)];
  }

  /**
   * Get all involved tables from processed includes
   * Used for cache invalidation tracking
   */
  private getInvolvedTables(processedIncludes: ProcessedInclude[]): string[] {
    const tables = [this.collection]; // Always include main table

    const collectTables = (includes: ProcessedInclude[]) => {
      for (const include of includes) {
        // Add the related table from the alias
        if (include.alias) {
          const tableName = include.alias.split('_')[0]; // Extract table name from alias
          tables.push(tableName);
        }

        // Also try to get table name from the table object
        if (include.table && typeof include.table === 'object') {
          const tableName = (include.table as any)[Symbol.for('drizzle:Name')];
          if (tableName) {
            tables.push(tableName);
          }
        }

        // For M2M relations, also include junction table if available
        if (include.relationType === 'BelongsToMany') {
          // Junction table would be tracked separately in the relation definition
          const relationDef = schemaManager.getRelation(this.collection, include.relation);
          if (relationDef?.junctionTable) {
            tables.push(relationDef.junctionTable);
          }
        }

        // Recursively handle nested includes
        if (include.nested && include.nested.length > 0) {
          collectTables(include.nested);
        }
      }
    };

    collectTables(processedIncludes);

    // Return unique table names only
    return [...new Set(tables)];
  }

  /**
   * Generate cache key from query parameters
   */
  private generateCacheKey(query: QueryOptions, processedIncludes: ProcessedInclude[]): string {
    const keyParts = [
      `collection:${this.collection}`,
      `filter:${JSON.stringify(query.filter || {})}`,
      `sort:${JSON.stringify(query.sort || {})}`,
      `fields:${JSON.stringify(query.fields || [])}`,
      `limit:${query.limit || 'none'}`,
      `offset:${query.offset || 0}`,
      `page:${query.page || 'none'}`,
      `search:${query.search || ''}`,
      `includes:${processedIncludes.map(i => i.relation).join(',')}`,
      `paranoid:${query.paranoid !== false}`,
    ];

    // Add tenant context if multi-tenant
    if (this.accountability?.tenant) {
      keyParts.push(`tenant:${this.accountability.tenant}`);
    }

    // Add user context for user-specific data
    if (this.accountability?.user?.id) {
      keyParts.push(`user:${this.accountability.user.id}`);
    }

    return keyParts.join('|');
  }

  /**
   * Execute query with cache wrapper
   * Checks cache before querying, stores results after query
   */
  private async executeWithCache<T>(
    cacheKey: string,
    tables: string[],
    queryFn: () => Promise<T>
  ): Promise<T> {
    const cache = getCacheService();

    // If cache is disabled, execute query directly
    if (!cache) {
      return await queryFn();
    }

    try {
      // Try to get from cache
      const cachedResult = await cache.get(cacheKey);

      if (cachedResult !== undefined && cachedResult !== null) {
        console.log(`[Cache] HIT: ${this.collection} - ${cacheKey.substring(0, 100)}...`);
        return cachedResult as T;
      }

      // Cache miss - execute query
      console.log(`[Cache] MISS: ${this.collection} - ${cacheKey.substring(0, 100)}...`);
      const result = await queryFn();

      // Store in cache
      await cache.put(cacheKey, result, tables);
      console.log(`[Cache] STORED: ${this.collection} - Cached result for tables: ${tables.join(', ')}`);

      return result;
    } catch (error) {
      // Cache errors should not break the operation
      console.error('[Cache] Error during cache operation:', error);
      // Fallback to executing query without cache
      return await queryFn();
    }
  }

  /**
   * Invalidate cache for this collection and all related tables
   * Called after any mutation (create, update, delete)
   */
  private async invalidateCache(additionalTables: string[] = []): Promise<void> {
    const cache = getCacheService();

    if (!cache) {
      // Cache not enabled, nothing to do
      return;
    }

    try {
      // Invalidate by the main collection table
      const tablesToInvalidate = [this.collection, ...additionalTables];

      // Remove duplicates
      const uniqueTables = [...new Set(tablesToInvalidate)];

      console.log(`[ItemsService.invalidateCache] Invalidating cache for tables: ${uniqueTables.join(', ')}`);

      await cache.onMutate({ tables: uniqueTables });
    } catch (error) {
      // Cache invalidation failure should not break the operation
      console.error('[ItemsService.invalidateCache] Cache invalidation failed:', error);
    }
  }

  /**
   * Get role ID from accountability
   * Handles both string role names and role objects with id
   */
  private async getRoleId(): Promise<string | number | null> {
    if (!this.accountability?.role) return null;

    // If role is already an object with id, return it
    if (typeof this.accountability.role === 'object' && this.accountability.role.id) {
      return this.accountability.role.id;
    }

    // If role is a string, look up the role ID from the database
    if (typeof this.accountability.role === 'string') {
      const roleTable = schemaManager.getTable('baasix_Role');
      const role = await db
        .select()
        .from(roleTable)
        .where(eq(roleTable.name, this.accountability.role))
        .limit(1);

      if (role.length > 0) {
        const rolePK = schemaManager.getPrimaryKey('baasix_Role');
        return role[0][rolePK];
      }
    }

    return null;
  }

  /**
   * Check if user is administrator
   */
  private async isAdministrator(): Promise<boolean> {
    console.log('[isAdministrator] accountability:', JSON.stringify(this.accountability, null, 2));

    if (!this.accountability) {
      console.log('[isAdministrator] No accountability - returning true');
      return true;
    }
    if (Object.keys(this.accountability).length === 0) {
      console.log('[isAdministrator] Empty accountability - returning true');
      return true;
    }
    if (!this.accountability.role) {
      console.log('[isAdministrator] No role - returning false');
      return false;
    }

    // Check user.isAdmin flag first
    console.log('[isAdministrator] Checking user.isAdmin:', (this.accountability.user as any)?.isAdmin);
    if (this.accountability.user && (this.accountability.user as any).isAdmin === true) {
      console.log('[isAdministrator] User has isAdmin=true - returning true');
      return true;
    }

    // If role is a string, check directly
    if (typeof this.accountability.role === 'string') {
      console.log('[isAdministrator] Role is string:', this.accountability.role);
      return this.accountability.role === 'administrator';
    }

    // If role is an object with name, check the name
    if (typeof this.accountability.role === 'object' && (this.accountability.role as any).name) {
      console.log('[isAdministrator] Role object name:', (this.accountability.role as any).name);
      return (this.accountability.role as any).name === 'administrator';
    }

    // If role is an object with id, query the database
    const roleTable = schemaManager.getTable('baasix_Role');
    const rolePK = schemaManager.getPrimaryKey('baasix_Role');

    const role = await db
      .select()
      .from(roleTable)
      .where(eq(roleTable[rolePK], (this.accountability.role as any).id))
      .limit(1);

    return role.length > 0 && role[0].name === 'administrator';
  }

  /**
   * Apply tenant context to query filter
   */
  private async enforceTenantContextFilter(filter: FilterObject = {}): Promise<FilterObject> {
    if (!this.isMultiTenant) return filter;

    const shouldEnforce = await shouldEnforceTenantContext(this);
    if (!shouldEnforce) return filter;

    const tenantId = this.tenant || this.accountability?.tenant;
    if (!tenantId) {
      throw new APIError('Tenant context required but not provided', 403);
    }

    // Use buildTenantFilter which handles isPublic bypass for supported collections (e.g., baasix_File)
    const tenantFilter = buildTenantFilter(this.collection, tenantId);

    return combineFilters(filter, tenantFilter);
  }

  /**
   * Validate and enforce tenant context on data
   */
  private async validateAndEnforceTenantContext(data: Record<string, any>): Promise<Record<string, any>> {
    if (!this.isMultiTenant) return data;

    const shouldEnforce = await shouldEnforceTenantContext(this);
    if (!shouldEnforce) return data;

    const tenantId = this.tenant || this.accountability?.tenant;
    if (!tenantId) {
      throw new APIError('Tenant context required but not provided', 403);
    }

    // Validate tenant context
    await validateTenantContext(data, this);

    // Enforce tenant_Id
    return {
      ...data,
      tenant_Id: tenantId
    };
  }

  /**
   * Helper to apply nested joins recursively
   */
  private applyNestedJoins(baseQuery: any, includes: ProcessedInclude[]): any {
    for (const include of includes) {
      if (include.separate) continue;

      if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
        baseQuery = baseQuery.leftJoin(include.table, include.joinCondition);

        if (include.nested.length > 0) {
          baseQuery = this.applyNestedJoins(baseQuery, include.nested);
        }
      }
    }
    return baseQuery;
  }


  /**
   * Build complete query with filters, sorts, pagination, includes
   */
  private async buildQuery(
    query: QueryOptions,
    options: {
      isAdmin: boolean;
      action: 'read' | 'create' | 'update' | 'delete';
      bypassPermissions?: boolean;
      idFilter?: string | number;
    }
  ): Promise<{
    whereClause: SQL | undefined;
    orderByClause: SQL[] | undefined;
    selectColumns: Record<string, any>;
    joins: SQL[];
    processedIncludes: ProcessedInclude[];
    limit?: number;
    offset?: number;
    filterJoins: any[];
  }> {
    const { isAdmin, action, bypassPermissions, idFilter } = options;

    // Start with base filter
    let filter = query.filter || {};

    // Apply ID filter if provided
    if (idFilter !== undefined) {
      filter = combineFilters(filter, {
        [this.primaryKey]: idFilter
      });
    }

    // Apply permission filters
    if (!bypassPermissions && !isAdmin) {
      const roleId = await this.getRoleId();

      // First, check if user has permission to perform this action
      const hasAccess = await permissionService.canAccess(
        roleId,
        this.collection,
        action
      );

      if (!hasAccess) {
        throw new APIError(
          `You don't have permission to ${action} items in '${this.collection}'`,
          403
        );
      }

      // Then apply permission filters
      const permissionFilter = await permissionService.getFilter(
        roleId,
        this.collection,
        action,
        this.accountability
      );

      if (permissionFilter.conditions) {
        filter = combineFilters(filter, permissionFilter.conditions);
      }
    }

    // Apply tenant context
    filter = await this.enforceTenantContextFilter(filter);

    // Resolve dynamic variables in filter
    filter = await resolveDynamicVariables(filter, this.accountability);

    // Apply soft delete filter (paranoid mode)
    // Exclude soft-deleted records unless paranoid: false is specified in options
    const isParanoid = schemaManager.isParanoid(this.collection);
    const includeDeleted = query.paranoid === false; // Explicit false check
    
    if (isParanoid && !includeDeleted) {
      // Add deletedAt IS NULL filter
      filter = combineFilters(filter, {
        [`${this.collection}.deletedAt`]: { _is_null: true }
      });
    }

    // Get fields to select
    const fields = query.fields || ['*'];

    // Expand fields with includes
    const { directFields, includes: processedIncludes } = expandFieldsWithIncludes(
      fields,
      this.collection
    );

    // Ensure primary key is always included when there are relations
    // This is needed for loadHasManyRelations to work correctly
    if (processedIncludes.length > 0 && !directFields.includes(this.primaryKey)) {
      directFields.unshift(this.primaryKey);
    }

    // Use processed includes from field expansion
    // Note: query.include is not used - includes are derived from fields parameter
    const allIncludes = [...processedIncludes];

    // Apply relConditions to includes (supports nested relConditions)
    if (query.relConditions) {
      const resolvedRelConditions = await resolveDynamicVariables(query.relConditions, this.accountability);

      // Recursive function to apply relConditions to includes and their nested includes
      const applyRelConditionsRecursive = (includes: any[], relConds: Record<string, any>) => {
        for (const include of includes) {
          const relationConditions = relConds[include.relation];
          if (relationConditions) {
            // Separate filter conditions from nested relation conditions
            const filterConditions: Record<string, any> = {};
            const nestedRelConditions: Record<string, any> = {};

            for (const [key, value] of Object.entries(relationConditions)) {
              // Keys that are logical operators (AND, OR) are always filter conditions
              // Everything else is either a field filter or a nested relation name
              if (key === 'AND' || key === 'OR') {
                filterConditions[key] = value;
              } else {
                // Check if this key is a nested relation by looking for it in includes
                const isNestedRelation = include.nested.some((nested: any) => nested.relation === key);

                if (isNestedRelation) {
                  // It's a nested relation (e.g., "tasks")
                  nestedRelConditions[key] = value;
                } else {
                  // It's a field filter condition
                  filterConditions[key] = value;
                }
              }
            }

            // Apply filter conditions to this include
            if (Object.keys(filterConditions).length > 0) {
              include.where = include.where
                ? combineFilters(include.where, filterConditions)
                : filterConditions;
            }

            // Recursively apply nested relConditions
            if (include.nested && include.nested.length > 0 && Object.keys(nestedRelConditions).length > 0) {
              applyRelConditionsRecursive(include.nested, nestedRelConditions);
            }
          }
        }
      };

      applyRelConditionsRecursive(allIncludes, resolvedRelConditions);
    }

    // Build select columns and joins for relations
    const { selectColumns, joins } = buildSelectWithJoins(
      this.table,
      directFields,
      allIncludes
    );
    console.log(`[ItemsService.buildQuery] ${this.collection} - directFields:`, directFields, 'selectColumns keys:', Object.keys(selectColumns));

    // Check if we need to add extra joins for sorting by HasMany relation fields
    // This handles the edge case where we sort by a field in a HasMany relation
    if (query.sort && hasSeparateQueries(allIncludes)) {
      // Extract sort fields to check if they reference separate relations
      let sortFields: string[] = [];
      if (typeof query.sort === 'string') {
        try {
          const sortObj = JSON.parse(query.sort);
          sortFields = Object.keys(sortObj);
        } catch (e) {
          // Ignore parse errors
        }
      } else if (Array.isArray(query.sort)) {
        sortFields = query.sort.map(f => f.startsWith('-') ? f.substring(1) : f);
      } else {
        sortFields = Object.keys(query.sort);
      }

      // For each sort field that references a relation, add joins
      for (const sortField of sortFields) {
        if (sortField.includes('.')) {
          // It's a relation field - expand it to get includes
          const { includes: sortIncludes } = expandFieldsWithIncludes(
            [sortField],
            this.collection
          );

          // Build joins for these includes
          const { joins: extraJoins } = buildSelectWithJoins(
            this.table,
            [],
            sortIncludes
          );

          // Add these joins if not already present
          joins.push(...extraJoins);
        }
      }
    }

    // Build where clause with join accumulation for relation path filters
    console.log(`[ItemsService.buildQuery] Collection: ${this.collection}, Filter:`, JSON.stringify(filter, null, 2));
    const filterJoins: any[] = [];
    let whereClause = drizzleWhere(filter, {
      table: this.table,
      tableName: this.collection,
      schema: this.table as any, // Pass table columns as schema
      joins: filterJoins // Accumulate joins from relation path filters
    });
    console.log(`[ItemsService.buildQuery] WHERE clause generated:`, whereClause ? 'yes' : 'no (undefined)');

    // Deduplicate filter joins by alias (multiple conditions on same relation create duplicates)
    const uniqueFilterJoins: any[] = [];
    const seenAliases = new Set<string>();
    for (const join of filterJoins) {
      if (!seenAliases.has(join.alias)) {
        seenAliases.add(join.alias);
        uniqueFilterJoins.push(join);
      }
    }
    // Replace filterJoins with deduplicated version
    filterJoins.length = 0;
    filterJoins.push(...uniqueFilterJoins);

    // Log filter joins if any were created
    if (filterJoins.length > 0) {
      console.log(`[ItemsService] Filter generated ${filterJoins.length} joins for relation paths`);
    }

    // Apply full-text search if search query is provided
    let searchOrderClause: SQL | undefined;
    if (query.search) {
      const { searchCondition, orderClause } = applyFullTextSearch(
        this.collection,
        this.table as any,
        query.search,
        query.searchFields,
        query.sortByRelevance
      );

      // Combine search condition with existing where clause
      if (whereClause) {
        whereClause = and(whereClause, searchCondition);
      } else {
        whereClause = searchCondition;
      }

      // Store search order clause for later
      searchOrderClause = orderClause;
    }

    // Build order by clause
    let orderByClause: SQL[] | undefined;
    if (query.sort) {
      // Convert sort array to sort object if needed
      let sortObj: Record<string, 'asc' | 'desc'> | string | null = null;
      if (Array.isArray(query.sort)) {
        sortObj = query.sort.reduce((acc, field) => {
          if (field.startsWith('-')) {
            acc[field.substring(1)] = 'desc';
          } else {
            acc[field] = 'asc';
          }
          return acc;
        }, {} as Record<string, 'asc' | 'desc'>);
      } else {
        sortObj = query.sort;
      }
      
      orderByClause = drizzleOrder(sortObj, {
        table: this.table,
        tableName: this.collection
      });
    } else if (searchOrderClause) {
      // If no explicit sort but search with relevance, use search order
      orderByClause = [searchOrderClause];
    }

    // Calculate pagination
    const { limit, offset } = applyPagination({
      limit: query.limit,
      page: query.page,
      offset: query.offset
    });

    // Merge filter joins with existing joins
    // Filter joins are from relation path filters (e.g., "userRoles.role.name")
    // Don't convert filterJoins to raw SQL - they will be applied using Drizzle query builder methods
    // use .leftJoin() and .innerJoin() instead of raw SQL

    return {
      whereClause,
      orderByClause,
      selectColumns,
      joins,
      processedIncludes,
      limit,
      offset,
      filterJoins
    };
  }

  /**
   * Apply field-level permissions
   */
  private async applyFieldPermissions(
    data: Record<string, any>,
    action: 'create' | 'update',
    isAdmin: boolean
  ): Promise<void> {
    if (isAdmin) return;

    const roleId = await this.getRoleId();

    const allowedFields = await permissionService.getAllowedFields(
      roleId,
      this.collection,
      action
    );

    if (!allowedFields || allowedFields.length === 0) {
      throw new APIError(`You don't have permission to ${action} this item`, 403);
    }

    // Validate field permissions
    const dataFields = Object.keys(data);
    const relationNames = schemaManager.getRelationNames(this.collection);

    for (const field of dataFields) {
      // Skip relation fields - they'll be handled separately
      if (relationNames.includes(field)) continue;

      // Check if field is allowed
      if (!allowedFields.includes(field) && !allowedFields.includes('*')) {
        throw new APIError(`You don't have permission to ${action} field: ${field}`, 403);
      }
    }
  }

  /**
   * Get default values from permissions
   */
  private async getDefaultValues(action: 'create' | 'update'): Promise<Record<string, any>> {
    const roleId = await this.getRoleId();
    if (!roleId) return {};

    return await permissionService.getDefaultValues(
      roleId,
      this.collection,
      action,
      this.accountability
    );
  }

  /**
   * Read with two-query approach for HasMany sorting
   */
  private async readWithHasManyHandling(
    query: QueryOptions,
    whereClause: SQL | undefined,
    orderByClause: SQL[] | undefined,
    processedIncludes: ProcessedInclude[],
    limit: number | undefined,
    offset: number | undefined,
    isAdmin: boolean,
    bypassPermissions: boolean,
    filterJoins: any[] = []
  ): Promise<ReadResult> {
    console.log('[ItemsService] Using Drizzle query builder for HasMany sorting/filtering');

    // STEP 1: Build ID query using PostgreSQL DISTINCT ON for proper deduplication
    // DISTINCT ON ensures we get unique IDs BEFORE applying LIMIT, not after
    // This matches Sequelize's approach

    // Build DISTINCT ON clause from sort fields + primary key
    const tableName = this.collection;
    const pkField = `"${tableName}"."${this.primaryKey}"`;
    const distinctOnFields: string[] = [];

    // Add sort fields from query.sort to DISTINCT ON
    if (query.sort && Array.isArray(query.sort)) {
      for (const sortItem of query.sort) {
        if (typeof sortItem === 'string') {
          // Simple sort: "fieldName" or "-fieldName"
          const fieldName = sortItem.startsWith('-') ? sortItem.slice(1) : sortItem;
          distinctOnFields.push(`"${tableName}"."${fieldName}"`);
        } else if (typeof sortItem === 'object') {
          // Object sort: { fieldName: 'asc' }
          for (const [fieldName, direction] of Object.entries(sortItem)) {
            if (fieldName.includes('.')) {
              // Relation path - need to resolve it
              // For now, skip relations in DISTINCT ON (will fallback to pk only)
              continue;
            }
            distinctOnFields.push(`"${tableName}"."${fieldName}"`);
          }
        }
      }
    }

    // Always add primary key to DISTINCT ON
    if (!distinctOnFields.includes(pkField)) {
      distinctOnFields.push(pkField);
    }

    // Build the DISTINCT ON clause
    const distinctOnClause = distinctOnFields.length > 0
      ? `DISTINCT ON (${distinctOnFields.join(', ')}) ${pkField}`
      : pkField;

    console.log(`[ItemsService] Using DISTINCT ON with fields: ${distinctOnFields.join(', ')}`);

    let idQuery = db
      .select({ [this.primaryKey]: sql.raw(distinctOnClause) })
      .from(this.table)
      .$dynamic();

    // Apply processedIncludes joins using Drizzle query builder
    for (const include of processedIncludes) {
      if (include.separate) {
        // For HasMany relations, we need the join for sorting even though data loads separately
        // Apply the join using Drizzle's leftJoin
        idQuery = idQuery.leftJoin(include.table, include.joinCondition);

        // Apply nested joins recursively
        if (include.nested.length > 0) {
          idQuery = this.applyNestedJoins(idQuery, include.nested);
        }
      } else if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
        idQuery = idQuery.leftJoin(include.table, include.joinCondition);

        if (include.nested.length > 0) {
          idQuery = this.applyNestedJoins(idQuery, include.nested);
        }
      }
    }

    // Apply filterJoins if present (using alias for custom aliases)
    if (filterJoins.length > 0) {
      console.log(`[ItemsService] Applying ${filterJoins.length} filterJoins to ID query`);
      for (const filterJoin of filterJoins) {
        const aliasedTable = alias(filterJoin.table, filterJoin.alias);
        const joinMethod = filterJoin.type === 'inner' ? 'innerJoin' :
                         filterJoin.type === 'right' ? 'rightJoin' : 'leftJoin';
        idQuery = idQuery[joinMethod](aliasedTable as any, filterJoin.condition);
      }
    }

    // Apply WHERE clause
    if (whereClause) {
      idQuery = idQuery.where(whereClause);
    }

    // Apply ORDER BY - must match DISTINCT ON for PostgreSQL
    // We need to ensure ORDER BY starts with the same columns as DISTINCT ON
    if (distinctOnFields.length > 0) {
      // Build ORDER BY from DISTINCT ON fields
      const orderByClauses: SQL[] = [];

      // Add all DISTINCT ON fields to ORDER BY (in same order)
      for (const field of distinctOnFields) {
        // Determine direction from original sort if available
        let direction = 'asc';
        if (query.sort && Array.isArray(query.sort)) {
          for (const sortItem of query.sort) {
            if (typeof sortItem === 'object') {
              for (const [fieldName, dir] of Object.entries(sortItem)) {
                if (field.includes(fieldName)) {
                  direction = String(dir).toLowerCase();
                  break;
                }
              }
            }
          }
        }
        orderByClauses.push(sql.raw(`${field} ${direction.toUpperCase()}`));
      }

      idQuery = idQuery.orderBy(...orderByClauses);
    } else if (orderByClause && orderByClause.length > 0) {
      // Fallback to original ORDER BY if no DISTINCT ON
      idQuery = idQuery.orderBy(...orderByClause);
    }

    // Apply pagination
    if (limit !== undefined && limit !== -1) {
      idQuery = idQuery.limit(limit);
    }
    if (offset !== undefined) {
      idQuery = idQuery.offset(offset);
    }

    // Execute ID query
    console.log('[ItemsService] Executing ID query with DISTINCT ON');
    const idRecords = await idQuery;

    // Extract IDs from the result (already deduplicated by DISTINCT ON)
    const ids: any[] = idRecords
      .map(record => record[this.primaryKey])
      .filter(id => id != null);

    console.log(`[ItemsService] Got ${ids.length} unique IDs from DISTINCT ON query`);

    // If no IDs found, return empty result
    if (ids.length === 0) {
      return {
        data: [],
        totalCount: 0
      };
    }

    // STEP 2: Get full records for these IDs with original includes
    // Build select columns for full query
    const fields = query.fields || ['*'];
    const { directFields } = expandFieldsWithIncludes(fields, this.collection);
    const { selectColumns } = buildSelectWithJoins(
      this.table,
      directFields,
      processedIncludes // Use original includes with separate: true for HasMany
    );

    let fullQuery: any = db.select(selectColumns).from(this.table);

    // Apply joins (only BelongsTo/HasOne, not HasMany)
    for (const include of processedIncludes) {
      if (include.separate) continue; // Skip HasMany for JOINs

      if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
        fullQuery = fullQuery.leftJoin(include.table, include.joinCondition);

        if (include.nested.length > 0) {
          fullQuery = this.applyNestedJoins(fullQuery, include.nested);
        }
      }
    }

    // Filter by IDs from first query
    fullQuery = fullQuery.where(inArray(this.getPrimaryKeyColumn(), ids));

    // Execute second query
    const records = await fullQuery;

    // Load separate relations (HasMany, BelongsToMany) and nest joined relations
    let finalRecords = records;
    if (hasSeparateQueries(processedIncludes)) {
      // This handles both nesting joined relations and loading separate ones
      finalRecords = await loadSeparateRelations(
        db,
        records,
        processedIncludes,
        this.collection
      );
    } else {
      // No separate queries, but we still need to nest joined BelongsTo/HasOne relations
      finalRecords = nestJoinedRelations(records, processedIncludes);
    }

    // Maintain order from first query
    const recordMap = new Map(finalRecords.map(r => [r[this.primaryKey], r]));
    const orderedRecords = ids.map(id => recordMap.get(id)).filter(r => r != null);

    // Get total count using Drizzle query builder (same joins as ID query)
    let countQuery = db
      .select({ count: sql`COUNT(DISTINCT ${this.getPrimaryKeyColumn()})`.mapWith(Number) })
      .from(this.table)
      .$dynamic();

    // Apply same joins as ID query
    for (const include of processedIncludes) {
      if (include.separate) {
        countQuery = countQuery.leftJoin(include.table, include.joinCondition);
        if (include.nested.length > 0) {
          countQuery = this.applyNestedJoins(countQuery, include.nested);
        }
      } else if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
        countQuery = countQuery.leftJoin(include.table, include.joinCondition);
        if (include.nested.length > 0) {
          countQuery = this.applyNestedJoins(countQuery, include.nested);
        }
      }
    }

    // Apply filterJoins
    if (filterJoins.length > 0) {
      for (const filterJoin of filterJoins) {
        const aliasedTable = alias(filterJoin.table, filterJoin.alias);
        const joinMethod = filterJoin.type === 'inner' ? 'innerJoin' :
                         filterJoin.type === 'right' ? 'rightJoin' : 'leftJoin';
        countQuery = countQuery[joinMethod](aliasedTable as any, filterJoin.condition);
      }
    }

    // Apply WHERE clause
    if (whereClause) {
      countQuery = countQuery.where(whereClause);
    }

    const countResult = await countQuery;
    const totalCount = countResult[0]?.count || 0;

    return {
      data: orderedRecords,
      totalCount
    };
  }

  /**
   * Check if we need two-query approach for sorting by HasMany relations
   */
  private needsHasManyHandling(
    sortFields: string[],
    processedIncludes: ProcessedInclude[]
  ): boolean {
    // Build a map of relation paths to their includes
    const relationMap = new Map<string, ProcessedInclude>();

    const addToMap = (includes: ProcessedInclude[], prefix = '') => {
      for (const include of includes) {
        const path = prefix ? `${prefix}.${include.relation}` : include.relation;
        relationMap.set(path, include);

        if (include.nested.length > 0) {
          addToMap(include.nested, path);
        }
      }
    };

    addToMap(processedIncludes);

    // Check if any sort field references a HasMany relation
    for (const sortField of sortFields) {
      if (!sortField.includes('.')) continue;

      // Extract relation path (e.g., "userRoles.role.name" -> "userRoles.role")
      const parts = sortField.split('.');
      for (let i = 1; i < parts.length; i++) {
        const relationPath = parts.slice(0, i).join('.');
        const include = relationMap.get(relationPath);

        if (include && include.separate) {
          // This sort field references a HasMany relation
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Read records by query
   */
  async readByQuery(
    query: QueryOptions = {},
    bypassPermissions: boolean = false
  ): Promise<ReadResult> {
    // Execute before-read hooks
    let hookData = await hooksManager.executeHooks(
      this.collection,
      'items.read',
      this.accountability,
      { query }
    );

    const modifiedQuery = hookData.query as QueryOptions;

    try {
      const isAdmin = await this.isAdministrator();

      // Check if this is an aggregate query
      if (modifiedQuery.aggregate) {
        return await this.executeAggregateQuery(modifiedQuery, isAdmin, bypassPermissions);
      }

      // Build query components
      const {
        whereClause,
        orderByClause,
        selectColumns,
        joins,
        processedIncludes,
        limit,
        offset,
        filterJoins = []
      } = await this.buildQuery(modifiedQuery, {
        isAdmin,
        action: 'read',
        bypassPermissions
      }) as any;

      // Extract sort fields to check if we need two-query approach
      let sortFields: string[] = [];
      if (modifiedQuery.sort) {
        if (typeof modifiedQuery.sort === 'string') {
          try {
            const sortObj = JSON.parse(modifiedQuery.sort);
            sortFields = Object.keys(sortObj);
          } catch (e) {
            // Ignore parse errors
          }
        } else if (Array.isArray(modifiedQuery.sort)) {
          sortFields = modifiedQuery.sort.map(f => f.startsWith('-') ? f.substring(1) : f);
        } else {
          sortFields = Object.keys(modifiedQuery.sort);
        }
      }

      // Check if we need two-query approach for HasMany sorting
      const needsHasManyHandling = this.needsHasManyHandling(sortFields, processedIncludes);

      // Check if we have filter joins (relational filters that need joins)
      const hasFilterJoins = filterJoins && filterJoins.length > 0;

      // Use readWithHasManyHandling for:
      // 1. HasMany sorting (to handle duplicates from joins)
      // 2. HasMany filtering with pagination (to deduplicate before applying LIMIT)
      // This matches Sequelize's approach of using a two-query pattern
      if (needsHasManyHandling || hasFilterJoins) {
        console.log(`[ItemsService] Using readWithHasManyHandling for ${needsHasManyHandling ? 'HasMany sorting' : 'HasMany filtering'}`);
        return await this.readWithHasManyHandling(
          modifiedQuery,
          whereClause,
          orderByClause,
          processedIncludes,
          limit,
          offset,
          isAdmin,
          bypassPermissions,
          filterJoins
        );
      }

      // Build base query
      console.log(`[ItemsService.readByQuery] Building base query for ${this.collection}, selectColumns has ${Object.keys(selectColumns).length} keys`);
      if (Object.keys(selectColumns).length === 0) {
        console.error(`[ItemsService.readByQuery] ERROR: selectColumns is EMPTY for ${this.collection}! This will cause SQL syntax error.`);
        console.error(`[ItemsService.readByQuery] query:`, query);
      }
      let baseQuery: any = db.select(selectColumns).from(this.table);

      // Apply filterJoins using Drizzle's query builder 
      // FilterJoins are created when filtering by relation paths (e.g., "userRoles.role.name")
      if (hasFilterJoins) {
        console.log(`[ItemsService] Applying ${filterJoins.length} filterJoins using Drizzle query builder`);

        for (const filterJoin of filterJoins) {
          // Use alias() to create an aliased table with the exact alias used in the WHERE clause
          const aliasedTable = alias(filterJoin.table, filterJoin.alias);

          // Apply join using Drizzle's leftJoin (or other join type)
          const joinMethod = filterJoin.type === 'inner' ? 'innerJoin' :
                           filterJoin.type === 'right' ? 'rightJoin' : 'leftJoin';

          baseQuery = baseQuery[joinMethod](aliasedTable as any, filterJoin.condition);

          console.log(`[ItemsService] Applied ${joinMethod}: ${filterJoin.tableName} AS ${filterJoin.alias}`);
        }
      }

      // Apply processedIncludes joins (for fetching related data in SELECT)
      if (processedIncludes.length > 0) {
        for (const include of processedIncludes) {
          if (include.separate) continue; // Skip HasMany relations loaded separately

          if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
            // Apply join with Drizzle API
            baseQuery = baseQuery.leftJoin(include.table, include.joinCondition);

            // Apply nested joins recursively
            if (include.nested.length > 0) {
              baseQuery = this.applyNestedJoins(baseQuery, include.nested);
            }
          }
        }
      }

      // Apply where clause
      if (whereClause) {
        baseQuery = baseQuery.where(whereClause);
      }

      // Apply ordering
      if (orderByClause && orderByClause.length > 0) {
        baseQuery = baseQuery.orderBy(...orderByClause);
      }

      // Apply pagination
      if (limit !== undefined && limit !== -1) {
        baseQuery = baseQuery.limit(limit);
      }
      if (offset !== undefined) {
        baseQuery = baseQuery.offset(offset);
      }

      // Generate cache key and get involved tables
      const cacheKey = this.generateCacheKey(modifiedQuery, processedIncludes);
      const involvedTables = this.getInvolvedTables(processedIncludes);

      // Execute main query with cache
      const { records: finalRecords, totalCount } = await this.executeWithCache(
        cacheKey,
        involvedTables,
        async () => {
          // Execute main query
          let records;
          try {
            records = await baseQuery;
          } catch (queryError) {
            console.error(`[ItemsService.readByQuery] Query execution failed for ${this.collection}`);
            console.error(`[ItemsService.readByQuery] selectColumns:`, Object.keys(selectColumns));
            console.error(`[ItemsService.readByQuery] whereClause exists:`, !!whereClause);
            console.error(`[ItemsService.readByQuery] orderByClause exists:`, !!orderByClause);
            console.error(`[ItemsService.readByQuery] Query error:`, queryError.message);
            throw queryError;
          }

          // Note: Deduplication for filterJoins is now handled by readWithHasManyHandling
          // which uses a two-query approach (fetch IDs first, deduplicate, then fetch full records)

          // Load separate relations (HasMany, BelongsToMany) and nest joined relations
          let processedRecords = records;
          if (hasSeparateQueries(processedIncludes)) {
            processedRecords = await loadSeparateRelations(
              db,
              records,
              processedIncludes,
              this.collection
            );
          } else {
            // No separate queries, but we still need to nest joined BelongsTo/HasOne relations
            processedRecords = nestJoinedRelations(records, processedIncludes);
          }

          // Get total count
          const primaryKeyColumn = this.getPrimaryKeyColumn();
          if (!primaryKeyColumn) {
            console.error(`[ItemsService.readByQuery] Primary key column is undefined for ${this.collection}!`);
            console.error(`[ItemsService.readByQuery] Primary key name:`, this.primaryKey);
            console.error(`[ItemsService.readByQuery] Available columns:`, Object.keys(this.table).filter(k => !k.startsWith('_')));
          }
          let countQuery: any = db.select({ count: sql`COUNT(DISTINCT ${primaryKeyColumn})` }).from(this.table);

          // Apply same joins and where for count
          if (hasFilterJoins) {
            // Use filterJoins for count query as well
            for (const filterJoin of filterJoins) {
              const aliasedTable = alias(filterJoin.table, filterJoin.alias);
              countQuery = countQuery.leftJoin(aliasedTable as any, filterJoin.condition);
            }
          } else {
            for (const include of processedIncludes) {
              if (include.separate) continue;

              if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
                countQuery = countQuery.leftJoin(include.table, include.joinCondition);

                if (include.nested.length > 0) {
                  countQuery = this.applyNestedJoins(countQuery, include.nested);
                }
              }
            }
          }
          if (whereClause) {
            countQuery = countQuery.where(whereClause);
          }

          let countResult, count;
          try {
            countResult = await countQuery;
            count = Number(countResult[0]?.count || 0);
          } catch (countError) {
            console.error(`[ItemsService.readByQuery] Count query execution failed for ${this.collection}`);
            console.error(`[ItemsService.readByQuery] Count query error:`, countError.message);
            console.error(`[ItemsService.readByQuery] HasFilterJoins:`, hasFilterJoins);
            console.error(`[ItemsService.readByQuery] ProcessedIncludes count:`, processedIncludes.length);
            throw countError;
          }

          // Return both records and count to be cached together
          return {
            records: processedRecords,
            totalCount: count
          };
        }
      );

      // Execute after-read hooks
      hookData = await hooksManager.executeHooks(
        this.collection,
        'items.read.after',
        this.accountability,
        { query: modifiedQuery, result: { data: finalRecords, totalCount } }
      );

      return hookData.result;
    } catch (error) {
      console.error('Error in readByQuery:', error);
      throw error;
    }
  }

  /**
   * Execute aggregate query
   */
  private async executeAggregateQuery(
    query: QueryOptions,
    isAdmin: boolean,
    bypassPermissions: boolean
  ): Promise<ReadResult> {
    const { aggregate, groupBy = [], filter = {}, sort } = query;

    if (!aggregate) {
      throw new APIError('Aggregate query requires aggregate parameter', 400);
    }

    // Extract all relation paths from the query
    const relationPaths = new Set<string>();

    // From groupBy fields
    for (const field of groupBy) {
      if (field.includes('.') && !field.startsWith('date:')) {
        relationPaths.add(field);
      }
    }

    // From aggregate field specifications
    for (const [alias, aggregateInfo] of Object.entries(aggregate as Record<string, any>)) {
      const field = aggregateInfo.field;
      if (field && field.includes('.')) {
        relationPaths.add(field);
      }
    }

    // Apply filter with permissions and tenant context
    let combinedFilter = filter;

    if (!bypassPermissions && !isAdmin) {
      const roleId = await this.getRoleId();
      const permissionFilter = await permissionService.getFilter(
        roleId,
        this.collection,
        'read',
        this.accountability
      );

      if (permissionFilter.conditions) {
        combinedFilter = combineFilters(combinedFilter, permissionFilter.conditions);
      }
    }

    combinedFilter = await this.enforceTenantContextFilter(combinedFilter);
    combinedFilter = await resolveDynamicVariables(combinedFilter, this.accountability);

    // Build WHERE clause and accumulate filter joins
    const filterJoins: any[] = [];
    const whereClause = drizzleWhere(combinedFilter, {
      table: this.table,
      tableName: this.collection,
      joins: filterJoins
    });

    // Deduplicate filter joins by alias
    const uniqueFilterJoins: any[] = [];
    const seenAliases = new Set<string>();
    for (const join of filterJoins) {
      if (!seenAliases.has(join.alias)) {
        seenAliases.add(join.alias);
        uniqueFilterJoins.push(join);
      }
    }
    filterJoins.length = 0;
    filterJoins.push(...uniqueFilterJoins);

    // Resolve all relation paths to joins
    const allJoins: any[] = [...filterJoins];
    const pathToAliasMap = new Map<string, string>(); // Maps relation path to final table alias

    for (const relationPath of relationPaths) {
      try {
        const resolved = resolveRelationPath(
          relationPath,
          this.table,
          this.collection
        );

        // Store the mapping from path to final alias
        pathToAliasMap.set(relationPath, resolved.finalAlias);

        // Add any new joins (avoid duplicates)
        for (const join of resolved.joins) {
          const exists = allJoins.some(j => j.alias === join.alias);
          if (!exists) {
            allJoins.push(join);
          }
        }
      } catch (error) {
        console.warn(`[ItemsService] Could not resolve relation path ${relationPath}:`, error.message);
      }
    }

    // Build aggregate attributes with alias mapping for relations
    const ctx = { tableName: this.collection, pathToAliasMap };
    const attributes = buildAggregateAttributes(aggregate, groupBy, ctx);

    // Build select object
    const selectObj: Record<string, any> = {};

    // Add group by fields with alias mapping for relations
    for (const groupField of groupBy) {
      const groupExpr = buildGroupByExpressions([groupField], undefined, pathToAliasMap)[0];
      selectObj[groupField] = groupExpr;
    }

    // Add aggregate functions
    for (const [expr, alias] of attributes) {
      selectObj[alias] = expr;
    }

    // Execute aggregate query using Drizzle query builder 
    let results;

    if (allJoins.length > 0) {
      // Build aggregate query using Drizzle query builder
      let aggregateQuery = db.select(selectObj).from(this.table).$dynamic();

      // Apply joins (same as filterJoins)
      for (const join of allJoins) {
        // Create aliased table with the exact alias
        const aliasedTable = alias(join.table, join.alias);

        // Apply join using Drizzle's leftJoin (or other join type)
        const joinMethod = join.type === 'inner' ? 'innerJoin' :
                         join.type === 'right' ? 'rightJoin' : 'leftJoin';

        aggregateQuery = aggregateQuery[joinMethod](aliasedTable as any, join.condition);
      }

      // Apply WHERE clause
      if (whereClause) {
        aggregateQuery = aggregateQuery.where(whereClause);
      }

      // Apply GROUP BY with alias mapping for relations
      if (groupBy.length > 0) {
        const groupByExprs = buildGroupByExpressions(groupBy, undefined, pathToAliasMap);
        aggregateQuery = aggregateQuery.groupBy(...groupByExprs);
      }

      // Apply ORDER BY - for aggregate queries, check if sorting by aggregate alias
      if (sort) {
        const sortObj = typeof sort === 'string' ? JSON.parse(sort) : sort;
        const orderByClause: any[] = [];

        for (const [field, direction] of Object.entries(sortObj)) {
          // Check if this field is an aggregate alias in selectObj
          if (selectObj[field]) {
            // Use the aggregate expression from selectObj directly
            const normalizedDirection = (direction as string).toUpperCase();
            const expr = selectObj[field];
            orderByClause.push(normalizedDirection === 'ASC' ? asc(expr) : desc(expr));
          } else {
            // Use drizzleOrder for non-aggregate fields
            const clause = drizzleOrder({ [field]: direction as any }, {
              table: this.table,
              tableName: this.collection
            });
            orderByClause.push(...clause);
          }
        }

        if (orderByClause.length > 0) {
          aggregateQuery = aggregateQuery.orderBy(...orderByClause);
        }
      }

      // Execute query
      results = await aggregateQuery;
    } else {
      // No relation joins - use standard Drizzle API
      let aggregateQuery = db.select(selectObj).from(this.table).$dynamic();

      if (whereClause) {
        aggregateQuery = aggregateQuery.where(whereClause);
      }

      if (groupBy.length > 0) {
        const groupByExprs = buildGroupByExpressions(groupBy, undefined, pathToAliasMap);
        aggregateQuery = aggregateQuery.groupBy(...groupByExprs);
      }

      // Apply sorting if provided - for aggregate queries, check if sorting by aggregate alias
      if (sort) {
        const sortObj = typeof sort === 'string' ? JSON.parse(sort) : sort;
        const orderByClause: any[] = [];

        for (const [field, direction] of Object.entries(sortObj)) {
          // Check if this field is an aggregate alias in selectObj
          if (selectObj[field]) {
            // Use the aggregate expression from selectObj directly
            const normalizedDirection = (direction as string).toUpperCase();
            const expr = selectObj[field];
            orderByClause.push(normalizedDirection === 'ASC' ? asc(expr) : desc(expr));
          } else {
            // Use drizzleOrder for non-aggregate fields
            const clause = drizzleOrder({ [field]: direction as any }, {
              table: this.table,
              tableName: this.collection
            });
            orderByClause.push(...clause);
          }
        }

        if (orderByClause.length > 0) {
          aggregateQuery = aggregateQuery.orderBy(...orderByClause);
        }
      }

      // Execute query
      results = await aggregateQuery;
    }

    // For grouped results, count is the number of groups
    const totalCount = results.length;

    return {
      data: results,
      totalCount
    };
  }

  /**
   * Read a single record by ID
   */
  async readOne(
    id: string | number,
    query: QueryOptions = {},
    bypassPermissions: boolean = false
  ): Promise<any> {
    const parsedId = this.parseId(id);

    if (!parsedId) {
      throw new APIError('Invalid ID', 400);
    }

    // Execute before-read-one hooks
    let hookData = await hooksManager.executeHooks(
      this.collection,
      'items.read.one',
      this.accountability,
      { id: parsedId, query }
    );

    try {
      const isAdmin = await this.isAdministrator();

      // Build query with ID filter
      const {
        whereClause,
        selectColumns,
        joins,
        processedIncludes,
        filterJoins
      } = await this.buildQuery(query, {
        isAdmin,
        action: 'read',
        bypassPermissions,
        idFilter: parsedId
      });

      // Build base query
      let baseQuery: any = db.select(selectColumns).from(this.table);

      // Apply filterJoins first (these come from relation path filters in WHERE clause)
      // use Drizzle query builder methods instead of raw SQL
      if (filterJoins && filterJoins.length > 0) {
        filterJoins.forEach((join) => {
          const { table: joinTable, condition, type = 'left' } = join;
          const joinMethod = type === 'inner' ? 'innerJoin' : 'leftJoin';
          baseQuery = baseQuery[joinMethod](joinTable, condition);
        });
      }

      // Apply joins for includes (these are for loading related data)
      for (const include of processedIncludes) {
        if (include.separate) continue;

        if (include.relationType === 'BelongsTo' || include.relationType === 'HasOne') {
          baseQuery = baseQuery.leftJoin(include.table, include.joinCondition);

          if (include.nested.length > 0) {
            baseQuery = this.applyNestedJoins(baseQuery, include.nested);
          }
        }
      }

      // Apply where clause
      if (whereClause) {
        baseQuery = baseQuery.where(whereClause);
      }

      // Execute query
      const records = await baseQuery.limit(1);

      if (!records || records.length === 0) {
        throw new APIError("Item not found or you don't have permission to read it", 403);
      }

      // Load separate relations and nest joined relations
      let finalRecords = records;
      if (hasSeparateQueries(processedIncludes)) {
        finalRecords = await loadSeparateRelations(
          db,
          records,
          processedIncludes,
          this.collection
        );
      } else {
        // No separate queries, but we still need to nest joined BelongsTo/HasOne relations
        finalRecords = nestJoinedRelations(records, processedIncludes);
      }

      const document = finalRecords[0];

      // Execute after-read-one hooks
      hookData = await hooksManager.executeHooks(
        this.collection,
        'items.read.one.after',
        this.accountability,
        { id: parsedId, query, document }
      );

      return hookData.document;
    } catch (error) {
      console.error('Error in readOne:', error);
      throw error;
    }
  }

  /**
   * Create a new record
   * Uses createOneCore for the transactional logic and executes after hooks after commit
   */
  async createOne(
    data: Record<string, any>,
    options: OperationOptions = {}
  ): Promise<string | number> {
    console.log(`[ItemsService.createOne] START - Collection: ${this.collection}`);
    console.log('[ItemsService.createOne] Input data:', JSON.stringify(data));

    // Create transaction if not provided (matches Sequelize pattern)
    const transaction = options.transaction || (await createTransaction());
    const shouldCommit = !options.transaction; // Only commit if we created the transaction

    try {
      // Execute core create logic within transaction
      const result = await this.createOneCore(data, transaction, options);

      // Commit transaction if we created it
      if (shouldCommit) {
        await transaction.commit();
      }

      // Create audit log for create action (after commit for single operations)
      await this.createAuditLog('create', result.itemId, {
        before: null,
        after: result.document
      }, options.transaction);

      // Execute after-create hooks (after commit to prevent side effects on rollback)
      await hooksManager.executeHooks(
        this.collection,
        'items.create.after',
        this.accountability,
        { data: result.modifiedData, document: result.document, transaction: options.transaction }
      );

      // Invalidate cache for this collection and all related tables
      await this.invalidateCache(result.relatedTables);

      return result.itemId;
    } catch (error) {
      console.error('Error in createOne:', error);

      // Rollback transaction if we created it
      if (shouldCommit) {
        try {
          await transaction.rollback();
        } catch (rollbackError: any) {
          // Ignore __ROLLBACK__ errors as they're intentional
          if (rollbackError.message !== '__ROLLBACK__') {
            console.error('Error during rollback:', rollbackError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Internal method to perform core create logic without after hooks
   * Used by both createOne and createMany to separate transactional data operations
   * from after hooks that may have side effects (emails, third-party calls)
   * 
   * @param data - Item data to create
   * @param transaction - Transaction to use
   * @param options - Operation options
   * @returns Object containing item ID, document, modified data, and related tables for cache invalidation
   */
  private async createOneCore(
    data: Record<string, any>,
    transaction: Transaction,
    options: OperationOptions = {}
  ): Promise<{
    itemId: string | number;
    document: Record<string, any>;
    modifiedData: Record<string, any>;
    relatedTables: string[];
  }> {
    console.log(`[ItemsService.createOneCore] START - Collection: ${this.collection}`);
    console.log('[ItemsService.createOneCore] Input data:', JSON.stringify(data));

    // Execute before-create hooks with transaction
    let hookData = await hooksManager.executeHooks(
      this.collection,
      'items.create',
      this.accountability,
      { data, transaction: options.transaction }
    );

    let modifiedData = hookData.data;
    console.log('[ItemsService.createOneCore] After before-hooks, modifiedData:', JSON.stringify(modifiedData));

    // Hash password for baasix_User
    if (this.collection === 'baasix_User' && modifiedData.password) {
      console.log('[ItemsService.createOneCore] Hashing password for baasix_User');
      modifiedData.password = await argon2.hash(modifiedData.password);
    }

    const isAdmin = await this.isAdministrator();

    // Apply field permissions
    if (!options.bypassPermissions) {
      await this.applyFieldPermissions(modifiedData, 'create', isAdmin);
      const defaultValues = await this.getDefaultValues('create');
      modifiedData = { ...defaultValues, ...modifiedData };
    }

    // Validate and enforce tenant context
    modifiedData = await this.validateAndEnforceTenantContext(modifiedData);

    // Validate relational data
    await validateRelationalData(modifiedData, this.collection, this);

    // Handle circular dependencies
    const { resolvedData, deferredFields } = await resolveCircularDependencies(
      modifiedData,
      this.collection,
      this
    );

    // Process relational data (extract nested objects/arrays)
    const relationalResult = await processRelationalData(
      this.collection,
      resolvedData,
      this,
      ItemsService
    ) as RelationalResult;

    const { result: mainData, deferredM2M, deferredM2A, deferredHasMany } = relationalResult;

    // Handle usertrack: set userCreated_Id if enabled
    const schemaDefinition = await schemaManager.getSchemaDefinition(this.collection);
    if (schemaDefinition?.usertrack && this.accountability?.user?.id) {
      mainData.userCreated_Id = this.accountability.user.id;
    }

    // Handle sortEnabled: auto-assign sequential sort values
    if (schemaDefinition?.sortEnabled && !mainData.sort) {
      try {
        const maxSortResult: any = await transaction.execute(
          sql`SELECT COALESCE(MAX("sort"), 0) as "maxSort" FROM ${sql.raw(`"${this.collection}"`)}`
        );
        let maxSort = 0;
        if (maxSortResult && Array.isArray(maxSortResult)) {
          maxSort = maxSortResult[0]?.maxSort ?? 0;
        } else if (maxSortResult?.rows && Array.isArray(maxSortResult.rows)) {
          maxSort = maxSortResult.rows[0]?.maxSort ?? 0;
        }
        mainData.sort = Number(maxSort) + 1;
      } catch (sortError: any) {
        console.error('[ItemsService.createOneCore] Error assigning sort value:', sortError);
      }
    }

    // Filter out VIRTUAL (generated) fields
    if (schemaDefinition?.fields) {
      for (const [fieldName, fieldSchema] of Object.entries(schemaDefinition.fields)) {
        if ((fieldSchema as any).type === 'VIRTUAL' && fieldName in mainData) {
          delete mainData[fieldName];
        }
      }
    }

    // Remove undefined values before insert
    const cleanedData: Record<string, any> = {};
    for (const [key, value] of Object.entries(mainData)) {
      if (value !== undefined) {
        cleanedData[key] = value;
      }
    }

    // Convert date strings to Date objects for DateTime/Timestamp fields
    await this.convertDateFields(cleanedData, schemaDefinition);

    // Insert main record
    let item;
    try {
      const insertResult = await transaction
        .insert(this.table)
        .values(cleanedData)
        .returning();

      if (!insertResult || insertResult.length === 0) {
        throw new APIError('Failed to create item', 500);
      }
      item = insertResult[0];
    } catch (insertError: any) {
      console.error('Insert error details:', {
        collection: this.collection,
        error: insertError.message,
        cleanedDataKeys: Object.keys(cleanedData),
        cleanedData: cleanedData
      });
      throw insertError;
    }
    const itemId = item[this.primaryKey];

    // Process deferred fields (circular dependencies)
    await processDeferredFields(item, deferredFields, this, transaction);

    // Handle deferred HasMany relations
    for (const { association, associationInfo, value } of deferredHasMany) {
      await handleHasManyRelationship(item, association, associationInfo, value, this, ItemsService, transaction);
    }

    // Handle M2M relationships
    for (const { association, associationInfo, value } of deferredM2M) {
      await handleM2MRelationship(item, association, associationInfo, value, this, ItemsService, transaction);
    }

    // Handle M2A relationships
    for (const { association, associationInfo, value } of deferredM2A) {
      await handleM2ARelationship(item, association, associationInfo, value, this, ItemsService, transaction);
    }

    // Collect related tables for cache invalidation
    const relatedTables: string[] = [];
    if (deferredM2M.length > 0) {
      for (const { associationInfo } of deferredM2M) {
        if (associationInfo.junctionTable) {
          relatedTables.push(associationInfo.junctionTable);
        }
      }
    }
    if (deferredHasMany.length > 0) {
      for (const { associationInfo } of deferredHasMany) {
        if (associationInfo.relatedCollection) {
          relatedTables.push(associationInfo.relatedCollection);
        }
      }
    }
    if (deferredM2A.length > 0) {
      for (const { associationInfo } of deferredM2A) {
        if (associationInfo.relatedCollections) {
          relatedTables.push(...associationInfo.relatedCollections);
        }
      }
    }

    return {
      itemId,
      document: item,
      modifiedData,
      relatedTables
    };
  }

  /**
   * Create multiple records with transactional safety
   * 
   * This method ensures that:
   * 1. All items are created within a single transaction
   * 2. If any creation fails, all previous creations are rolled back
   * 3. After hooks (which may have external side effects like emails, API calls)
   *    are only executed AFTER the transaction is successfully committed
   * 
   * This prevents situations where:
   * - Emails are sent for items that were later rolled back
   * - Third-party systems are notified about changes that didn't persist
   * 
   * @param items - Array of items to create
   * @param options - Operation options
   * @returns Array of created item IDs
   */
  async createMany(
    items: Record<string, any>[],
    options: OperationOptions = {}
  ): Promise<(string | number)[]> {
    if (items.length === 0) {
      return [];
    }

    // Create transaction if not provided
    const transaction = options.transaction || (await createTransaction());
    const shouldCommit = !options.transaction; // Only commit if we created the transaction

    // Store results for after hooks
    const results: {
      itemId: string | number;
      document: Record<string, any>;
      modifiedData: Record<string, any>;
      relatedTables: string[];
    }[] = [];

    try {
      // Phase 1: Execute all core create operations within transaction
      for (const item of items) {
        const result = await this.createOneCore(item, transaction, options);
        results.push(result);
      }

      // Phase 2: Commit transaction (if we created it)
      if (shouldCommit) {
        await transaction.commit();
      }

      // Phase 3: Execute after hooks AFTER successful commit
      // These may have external side effects (emails, third-party calls)
      // that cannot be rolled back, so we only execute them after commit
      for (const result of results) {
        // Create audit log
        await this.createAuditLog('create', result.itemId, {
          before: null,
          after: result.document
        }, options.transaction);

        // Execute after-create hooks
        await hooksManager.executeHooks(
          this.collection,
          'items.create.after',
          this.accountability,
          { data: result.modifiedData, document: result.document, transaction: options.transaction }
        );
      }

      // Invalidate cache for all affected tables
      const allRelatedTables = [...new Set(results.flatMap(r => r.relatedTables))];
      await this.invalidateCache(allRelatedTables);

      return results.map(r => r.itemId);
    } catch (error) {
      console.error('Error in createMany:', error);

      // Rollback transaction if we created it
      if (shouldCommit) {
        try {
          await transaction.rollback();
        } catch (rollbackError: any) {
          if (rollbackError.message !== '__ROLLBACK__') {
            console.error('Error during rollback:', rollbackError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Internal method to perform core update logic without after hooks
   * Used by both updateOne and updateMany to separate transactional data operations
   * from after hooks that may have side effects (emails, third-party calls)
   * 
   * @param id - Item ID to update
   * @param data - Item data to update
   * @param transaction - Transaction to use
   * @param options - Operation options
   * @returns Object containing update info for after hooks execution
   */
  private async updateOneCore(
    id: string | number,
    data: Record<string, any>,
    transaction: Transaction,
    options: OperationOptions = {}
  ): Promise<{
    parsedId: string | number;
    modifiedData: Record<string, any>;
    finalDocument: Record<string, any>;
    previousDocument: Record<string, any>;
    relatedTables: string[];
  }> {
    const parsedId = this.parseId(id);

    // Execute before-update hooks with transaction
    let hookData = await hooksManager.executeHooks(
      this.collection,
      'items.update',
      this.accountability,
      { id: parsedId, data, transaction: options.transaction }
    );

    let modifiedData = hookData.data;

    // Hash password for baasix_User
    if (this.collection === 'baasix_User' && modifiedData.password) {
      modifiedData.password = await argon2.hash(modifiedData.password);
    }

    const isAdmin = await this.isAdministrator();

    // Apply field permissions
    if (!options.bypassPermissions) {
      await this.applyFieldPermissions(modifiedData, 'update', isAdmin);
      const defaultValues = await this.getDefaultValues('update');
      modifiedData = { ...defaultValues, ...modifiedData };
    }

    // Validate and enforce tenant context
    modifiedData = await this.validateAndEnforceTenantContext(modifiedData);

    // Filter out VIRTUAL (generated) fields
    let schemaDefinition = await schemaManager.getSchemaDefinition(this.collection);
    if (schemaDefinition?.fields) {
      for (const [fieldName, fieldSchema] of Object.entries(schemaDefinition.fields)) {
        if ((fieldSchema as any).type === 'VIRTUAL' && fieldName in modifiedData) {
          delete modifiedData[fieldName];
        }
      }
    }

    // Build filter for existing record check
    let filter: FilterObject = {
      [this.primaryKey]: parsedId
    };

    if (!options.bypassPermissions && !isAdmin) {
      const roleId = await this.getRoleId();
      const permissionFilter = await permissionService.getFilter(
        roleId,
        this.collection,
        'update',
        this.accountability
      );

      if (permissionFilter.conditions) {
        filter = combineFilters(filter, permissionFilter.conditions);
      }
    }

    filter = await this.enforceTenantContextFilter(filter);
    filter = await resolveDynamicVariables(filter, this.accountability);

    // Check if record exists and user has permission
    const filterJoins: any[] = [];
    const whereClause = drizzleWhere(filter, {
      table: this.table,
      tableName: this.collection,
      schema: this.table as any,
      joins: filterJoins,
      forPermissionCheck: true
    });

    // Deduplicate filter joins by alias
    const uniqueJoins: any[] = [];
    const seenAliases = new Set<string>();
    for (const join of filterJoins) {
      if (!seenAliases.has(join.alias)) {
        seenAliases.add(join.alias);
        uniqueJoins.push(join);
      }
    }
    filterJoins.length = 0;
    filterJoins.push(...uniqueJoins);

    let existingItems;
    if (filterJoins.length > 0) {
      // Use transaction for reads to prevent deadlocks and ensure consistency
      let query: any = transaction.select().from(this.table);
      filterJoins.forEach((join) => {
        const { table: joinTable, condition, type = 'left' } = join;
        const joinMethod = type === 'inner' ? 'innerJoin' : 'leftJoin';
        query = query[joinMethod](joinTable, condition);
      });
      existingItems = await query.where(whereClause).limit(1);
    } else {
      // Use transaction for reads to prevent deadlocks and ensure consistency
      existingItems = await transaction
        .select()
        .from(this.table)
        .where(whereClause)
        .limit(1);
    }

    if (!existingItems || existingItems.length === 0) {
      throw new APIError("Item not found or you don't have permission to update it", 403);
    }

    const existingItem = existingItems[0];

    // Ensure tenant_Id cannot be changed (except by admin)
    if (
      this.isMultiTenant &&
      modifiedData.tenant_Id &&
      modifiedData.tenant_Id !== existingItem.tenant_Id &&
      !isAdmin
    ) {
      throw new APIError("Cannot change item's tenant", 403);
    }

    // Process relational data
    const relationalResult = await processRelationalData(
      this.collection,
      modifiedData,
      this,
      ItemsService
    ) as RelationalResult;

    const { result: mainData, deferredM2M, deferredM2A, deferredHasMany } = relationalResult;

    // Handle usertrack: set userUpdated_Id if enabled
    if (!schemaDefinition) {
      schemaDefinition = await schemaManager.getSchemaDefinition(this.collection);
    }
    if (schemaDefinition?.usertrack && this.accountability?.user?.id) {
      mainData.userUpdated_Id = this.accountability.user.id;
    }

    // Convert date strings to Date objects for DateTime/Timestamp fields
    await this.convertDateFields(mainData, schemaDefinition);

    // Update main record only if there are fields to update
    let updatedItem;
    if (Object.keys(mainData).length > 0) {
      const updateResult = await transaction
        .update(this.table)
        .set(mainData)
        .where(eq(this.getPrimaryKeyColumn(), parsedId))
        .returning();

      if (!updateResult || updateResult.length === 0) {
        if (deferredM2M.length === 0 && deferredM2A.length === 0 && deferredHasMany.length === 0) {
          // No update needed, return existing item info
          return {
            parsedId,
            modifiedData,
            finalDocument: existingItem,
            previousDocument: existingItem,
            relatedTables: []
          };
        }
      }
      updatedItem = updateResult[0];
    } else {
      // Use transaction for reads to prevent deadlocks and ensure consistency
      const updatedItems = await transaction
        .select()
        .from(this.table)
        .where(eq(this.getPrimaryKeyColumn(), parsedId))
        .limit(1);
      updatedItem = updatedItems[0];
    }

    // Process deferred HasMany relations
    for (const { association, associationInfo, value } of deferredHasMany) {
      await handleHasManyRelationship(updatedItem, association, associationInfo, value, this, ItemsService, transaction);
    }

    // Handle M2M relationships
    for (const { association, associationInfo, value } of deferredM2M) {
      await handleM2MRelationship(updatedItem, association, associationInfo, value, this, ItemsService, transaction);
    }

    // Handle M2A relationships
    for (const { association, associationInfo, value } of deferredM2A) {
      await handleM2ARelationship(updatedItem, association, associationInfo, value, this, ItemsService, transaction);
    }

    // Get final item for hooks - use transaction for consistency
    const finalItems = await transaction
      .select()
      .from(this.table)
      .where(eq(this.getPrimaryKeyColumn(), parsedId))
      .limit(1);

    const finalItem = finalItems[0];

    // Collect related tables for cache invalidation
    const relatedTables: string[] = [];
    if (deferredM2M.length > 0) {
      for (const { associationInfo } of deferredM2M) {
        if (associationInfo.junctionTable) {
          relatedTables.push(associationInfo.junctionTable);
        }
      }
    }
    if (deferredHasMany.length > 0) {
      for (const { associationInfo } of deferredHasMany) {
        if (associationInfo.relatedCollection) {
          relatedTables.push(associationInfo.relatedCollection);
        }
      }
    }
    if (deferredM2A.length > 0) {
      for (const { associationInfo } of deferredM2A) {
        if (associationInfo.relatedCollections) {
          relatedTables.push(...associationInfo.relatedCollections);
        }
      }
    }

    return {
      parsedId,
      modifiedData,
      finalDocument: finalItem,
      previousDocument: existingItem,
      relatedTables
    };
  }

  /**
   * Update multiple records with transactional safety
   * 
   * This method ensures that:
   * 1. All items are updated within a single transaction
   * 2. If any update fails, all previous updates are rolled back
   * 3. After hooks (which may have external side effects like emails, API calls)
   *    are only executed AFTER the transaction is successfully committed
   * 
   * @param updates - Array of objects with id and data to update
   * @param options - Operation options
   * @returns Array of updated item IDs
   */
  async updateMany(
    updates: { id: string | number; data?: Record<string, any>; [key: string]: any }[],
    options: OperationOptions = {}
  ): Promise<(string | number)[]> {
    if (updates.length === 0) {
      return [];
    }

    // Create transaction if not provided
    const transaction = options.transaction || (await createTransaction());
    const shouldCommit = !options.transaction;

    // Store results for after hooks
    const results: {
      parsedId: string | number;
      modifiedData: Record<string, any>;
      finalDocument: Record<string, any>;
      previousDocument: Record<string, any>;
      relatedTables: string[];
    }[] = [];

    try {
      // Phase 1: Execute all core update operations within transaction
      for (const update of updates) {
        const { id, data, ...rest } = update;
        if (!id) continue;
        
        // Support both {id, data: {...}} and {id, field1, field2, ...} formats
        const updateData = data || rest;
        const result = await this.updateOneCore(id, updateData, transaction, options);
        results.push(result);
      }

      // Phase 2: Commit transaction (if we created it)
      if (shouldCommit) {
        await transaction.commit();
      }

      // Phase 3: Execute after hooks AFTER successful commit
      for (const result of results) {
        // Create audit log
        await this.createAuditLog('update', result.parsedId, {
          before: result.previousDocument,
          after: result.finalDocument
        }, options.transaction);

        // Execute after-update hooks
        await hooksManager.executeHooks(
          this.collection,
          'items.update.after',
          this.accountability,
          {
            id: result.parsedId,
            data: result.modifiedData,
            document: result.finalDocument,
            previousDocument: result.previousDocument,
            transaction: options.transaction
          }
        );
      }

      // Invalidate cache for all affected tables
      const allRelatedTables = [...new Set(results.flatMap(r => r.relatedTables))];
      await this.invalidateCache(allRelatedTables);

      return results.map(r => r.parsedId);
    } catch (error) {
      console.error('Error in updateMany:', error);

      if (shouldCommit) {
        try {
          await transaction.rollback();
        } catch (rollbackError: any) {
          if (rollbackError.message !== '__ROLLBACK__') {
            console.error('Error during rollback:', rollbackError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Update a record by ID
   * Uses updateOneCore for the transactional logic and executes after hooks after commit
   */
  async updateOne(
    id: string | number,
    data: Record<string, any>,
    options: OperationOptions = {}
  ): Promise<string | number> {
    // Create transaction if not provided (matches Sequelize pattern)
    const transaction = options.transaction || (await createTransaction());
    const shouldCommit = !options.transaction;

    try {
      // Execute core update logic within transaction
      const result = await this.updateOneCore(id, data, transaction, options);

      // Commit transaction if we created it
      if (shouldCommit) {
        await transaction.commit();
      }

      // Create audit log for update action (after commit)
      await this.createAuditLog('update', result.parsedId, {
        before: result.previousDocument,
        after: result.finalDocument
      }, options.transaction);

      // Execute after-update hooks (after commit to prevent side effects on rollback)
      await hooksManager.executeHooks(
        this.collection,
        'items.update.after',
        this.accountability,
        {
          id: result.parsedId,
          data: result.modifiedData,
          document: result.finalDocument,
          previousDocument: result.previousDocument,
          transaction: options.transaction
        }
      );

      // Invalidate cache for this collection and all related tables
      await this.invalidateCache(result.relatedTables);

      return result.parsedId;
    } catch (error) {
      console.error('Error in updateOne:', error);

      // Rollback transaction if we created it
      if (shouldCommit) {
        try {
          await transaction.rollback();
        } catch (rollbackError: any) {
          if (rollbackError.message !== '__ROLLBACK__') {
            console.error('Error during rollback:', rollbackError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Internal method to perform core delete logic without after hooks
   * Used by both deleteOne and deleteMany to separate transactional data operations
   * from after hooks that may have side effects (emails, third-party calls)
   * 
   * @param id - Item ID to delete
   * @param transaction - Transaction to use
   * @param options - Operation options
   * @returns Object containing delete info for after hooks execution
   */
  private async deleteOneCore(
    id: string | number,
    transaction: Transaction,
    options: OperationOptions = {}
  ): Promise<{
    parsedId: string | number;
    document: Record<string, any>;
  }> {
    const parsedId = this.parseId(id);

    // Execute before-delete hooks with transaction
    await hooksManager.executeHooks(
      this.collection,
      'items.delete',
      this.accountability,
      { id: parsedId, transaction: options.transaction }
    );

    const isAdmin = await this.isAdministrator();

    // Check permission
    if (!options.bypassPermissions && !isAdmin) {
      const roleId = await this.getRoleId();
      const hasPermission = await permissionService.canAccess(
        roleId,
        this.collection,
        'delete'
      );

      if (!hasPermission) {
        throw new APIError("You don't have permission to delete this item", 403);
      }
    }

    // Build filter for existing record check
    let filter: FilterObject = {
      [this.primaryKey]: parsedId
    };

    if (!options.bypassPermissions && !isAdmin) {
      const roleId = await this.getRoleId();
      const permissionFilter = await permissionService.getFilter(
        roleId,
        this.collection,
        'delete',
        this.accountability
      );

      if (permissionFilter.conditions) {
        filter = combineFilters(filter, permissionFilter.conditions);
      }
    }

    filter = await this.enforceTenantContextFilter(filter);
    filter = await resolveDynamicVariables(filter, this.accountability);

    // Check if record exists and user has permission
    const filterJoins: any[] = [];
    const whereClause = drizzleWhere(filter, {
      table: this.table,
      tableName: this.collection,
      schema: this.table as any,
      joins: filterJoins,
      forPermissionCheck: true
    });

    // Deduplicate filter joins by alias
    const uniqueJoins: any[] = [];
    const seenAliases = new Set<string>();
    for (const join of filterJoins) {
      if (!seenAliases.has(join.alias)) {
        seenAliases.add(join.alias);
        uniqueJoins.push(join);
      }
    }
    filterJoins.length = 0;
    filterJoins.push(...uniqueJoins);

    let existingItems;
    if (filterJoins.length > 0) {
      // Use transaction for reads to prevent deadlocks and ensure consistency
      let query: any = transaction.select().from(this.table);
      filterJoins.forEach((join) => {
        const { table: joinTable, condition, type = 'left' } = join;
        const joinMethod = type === 'inner' ? 'innerJoin' : 'leftJoin';
        query = query[joinMethod](joinTable, condition);
      });
      existingItems = await query.where(whereClause).limit(1);
    } else {
      // Use transaction for reads to prevent deadlocks and ensure consistency
      existingItems = await transaction
        .select()
        .from(this.table)
        .where(whereClause)
        .limit(1);
    }

    if (!existingItems || existingItems.length === 0) {
      throw new APIError("Item not found or you don't have permission to delete it", 403);
    }

    const item = existingItems[0];

    // Handle related records cleanup based on onDelete settings
    await handleRelatedRecordsBeforeDelete(item, this, transaction);

    // Check if paranoid mode is enabled
    const isParanoid = schemaManager.isParanoid(this.collection);
    const forceDelete = options.force === true;

    let result;

    if (isParanoid && !forceDelete) {
      // Soft delete: Set deletedAt timestamp
      const userId = this.accountability?.user?.id;
      const softDeleteData = softDelete(userId ? String(userId) : undefined);

      result = await transaction
        .update(this.table)
        .set(softDeleteData)
        .where(eq(this.getPrimaryKeyColumn(), parsedId))
        .returning();

      if (!result || result.length === 0) {
        throw new APIError('Item not found or already deleted', 404);
      }
    } else {
      // Hard delete: Physically remove from database
      result = await transaction
        .delete(this.table)
        .where(eq(this.getPrimaryKeyColumn(), parsedId))
        .returning();

      if (!result || result.length === 0) {
        throw new APIError('Item not found or already deleted', 404);
      }
    }

    return {
      parsedId,
      document: item
    };
  }

  /**
   * Delete multiple records with transactional safety
   * 
   * This method ensures that:
   * 1. All items are deleted within a single transaction
   * 2. If any deletion fails, all previous deletions are rolled back
   * 3. After hooks (which may have external side effects like emails, API calls)
   *    are only executed AFTER the transaction is successfully committed
   * 
   * @param ids - Array of item IDs to delete
   * @param options - Operation options
   * @returns Array of deleted item IDs
   */
  async deleteMany(
    ids: (string | number)[],
    options: OperationOptions = {}
  ): Promise<(string | number)[]> {
    if (ids.length === 0) {
      return [];
    }

    // Create transaction if not provided
    const transaction = options.transaction || (await createTransaction());
    const shouldCommit = !options.transaction;

    // Store results for after hooks
    const results: {
      parsedId: string | number;
      document: Record<string, any>;
    }[] = [];

    try {
      // Phase 1: Execute all core delete operations within transaction
      for (const id of ids) {
        const result = await this.deleteOneCore(id, transaction, options);
        results.push(result);
      }

      // Phase 2: Commit transaction (if we created it)
      if (shouldCommit) {
        await transaction.commit();
      }

      // Phase 3: Execute after hooks AFTER successful commit
      for (const result of results) {
        // Create audit log
        await this.createAuditLog('delete', result.parsedId, {
          before: result.document,
          after: null
        }, options.transaction);

        // Execute after-delete hooks
        await hooksManager.executeHooks(
          this.collection,
          'items.delete.after',
          this.accountability,
          { id: result.parsedId, document: result.document, transaction: options.transaction }
        );
      }

      // Invalidate cache for this collection
      await this.invalidateCache();

      return results.map(r => r.parsedId);
    } catch (error) {
      console.error('Error in deleteMany:', error);

      if (shouldCommit) {
        try {
          await transaction.rollback();
        } catch (rollbackError: any) {
          if (rollbackError.message !== '__ROLLBACK__') {
            console.error('Error during rollback:', rollbackError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Delete a record by ID
   * Uses deleteOneCore for the transactional logic and executes after hooks after commit
   */
  async deleteOne(
    id: string | number,
    options: OperationOptions = {}
  ): Promise<string | number> {
    // Create transaction if not provided (matches Sequelize pattern)
    const transaction = options.transaction || (await createTransaction());
    const shouldCommit = !options.transaction;

    try {
      // Execute core delete logic within transaction
      const result = await this.deleteOneCore(id, transaction, options);

      // Commit transaction if we created it
      if (shouldCommit) {
        await transaction.commit();
      }

      // Create audit log for delete action (after commit)
      await this.createAuditLog('delete', result.parsedId, {
        before: result.document,
        after: null
      }, options.transaction);

      // Execute after-delete hooks (after commit to prevent side effects on rollback)
      await hooksManager.executeHooks(
        this.collection,
        'items.delete.after',
        this.accountability,
        { id: result.parsedId, document: result.document, transaction: options.transaction }
      );

      // Invalidate cache for this collection
      await this.invalidateCache();

      return result.parsedId;
    } catch (error) {
      console.error('Error in deleteOne:', error);

      // Rollback transaction if we created it
      if (shouldCommit) {
        try {
          await transaction.rollback();
        } catch (rollbackError: any) {
          if (rollbackError.message !== '__ROLLBACK__') {
            console.error('Error during rollback:', rollbackError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * Alias for readByQuery
   */
  async list(query: QueryOptions = {}, bypassPermissions: boolean = false): Promise<ReadResult> {
    return this.readByQuery(query, bypassPermissions);
  }

  /**
   * Alias for readOne
   */
  async read(id: string | number, query: QueryOptions = {}, bypassPermissions: boolean = false): Promise<any> {
    return this.readOne(id, query, bypassPermissions);
  }

  /**
   * Alias for createOne
   */
  async create(data: Record<string, any>, options: OperationOptions = {}): Promise<string | number> {
    return this.createOne(data, options);
  }

  /**
   * Alias for updateOne
   */
  async update(
    id: string | number,
    data: Record<string, any>,
    options: OperationOptions = {}
  ): Promise<string | number> {
    return this.updateOne(id, data, options);
  }

  /**
   * Alias for deleteOne
   */
  async delete(id: string | number, options: OperationOptions = {}): Promise<string | number> {
    return this.deleteOne(id, options);
  }

  /**
   * Restore a soft-deleted record
   * Only works for collections with paranoid mode enabled
   */
  async restore(
    id: string | number,
    options: OperationOptions = {}
  ): Promise<string | number> {
    const parsedId = this.parseId(id);

    try {
      // Check if paranoid mode is enabled
      const isParanoid = schemaManager.isParanoid(this.collection);
      
      if (!isParanoid) {
        throw new APIError(`Collection ${this.collection} does not have soft delete enabled`, 400);
      }

      const isAdmin = await this.isAdministrator();

      // Check permission
      if (!options.bypassPermissions && !isAdmin) {
        const roleId = typeof this.accountability?.role === 'object' ? this.accountability.role.id : this.accountability?.role;
        const hasPermission = await permissionService.canAccess(
          roleId as number,
          this.collection,
          'update' // Restore requires update permission
        );

        if (!hasPermission) {
          throw new APIError("You don't have permission to restore this item", 403);
        }
      }

      // Build filter for existing record check (include soft-deleted)
      let filter: FilterObject = {
        [`${this.collection}.${this.primaryKey}`]: parsedId,
        [`${this.collection}.deletedAt`]: { _is_not_null: true } // Only restore soft-deleted items
      };

      filter = await this.enforceTenantContextFilter(filter);

      // Check if record exists and is soft-deleted
      const whereClause = drizzleWhere(filter, {
        table: this.table,
        tableName: this.collection
      });
      const existingItems = await db
        .select()
        .from(this.table)
        .where(whereClause)
        .limit(1);

      if (!existingItems || existingItems.length === 0) {
        throw new APIError("Item not found or not soft-deleted", 404);
      }

      // Restore: Set deletedAt to null
      const restoreData = restore();
      
      const result = await db
        .update(this.table)
        .set(restoreData)
        .where(eq(this.getPrimaryKeyColumn(), parsedId))
        .returning();

      if (!result || result.length === 0) {
        throw new APIError('Failed to restore item', 500);
      }

      return parsedId;
    } catch (error) {
      console.error('Error in restore:', error);
      throw error;
    }
  }

  /**
   * Create an audit log entry for create/update/delete operations
   * @param action - The action performed (create, update, delete)
   * @param entityId - The ID of the entity
   * @param changes - The changes made (before and after states)
   * @param transaction - Optional transaction to use
   */
  private async createAuditLog(
    action: 'create' | 'update' | 'delete',
    entityId: string | number,
    changes: { before: any; after: any },
    transaction?: Transaction
  ): Promise<void> {
    // Collections to exclude from audit logging
    const excludeCollections = ['baasix_AuditLog', 'baasix_Sessions'];

    // Skip audit log creation for excluded collections
    if (excludeCollections.includes(this.collection)) {
      return;
    }

    try {
      // Get special handling for baasix_SchemaDefinition - use collectionName as ID
      let auditEntityId = entityId;
      if (this.collection === 'baasix_SchemaDefinition' && changes.after?.collectionName) {
        auditEntityId = changes.after.collectionName;
      }

      // Serialize changes to JSON to avoid Postgres type issues
      // Drizzle expects JSON fields to be properly serialized
      const serializedChanges = {
        before: changes.before ? JSON.parse(JSON.stringify(changes.before)) : null,
        after: changes.after ? JSON.parse(JSON.stringify(changes.after)) : null
      };

      // Prepare audit log data
      const auditLogData: Record<string, any> = {
        type: 'data',
        entity: this.collection,
        entityId: String(auditEntityId),
        action: action,
        changes: serializedChanges,
        userId: this.accountability?.user?.id || null,
        ipaddress: this.accountability?.ipaddress || null,
      };

      // Add tenant_Id if multi-tenant is enabled
      const tenantId = this.tenant || this.accountability?.tenant;
      if (tenantId) {
        auditLogData.tenant_Id = tenantId;
      }

      // Create audit log entry using ItemsService to avoid circular dependency
      const auditLogTable = schemaManager.getTable('baasix_AuditLog');
      if (!auditLogTable) {
        console.warn('[AuditLog] baasix_AuditLog table not found, skipping audit log creation');
        return;
      }

      // Use transaction if provided, otherwise use db directly
      const dbClient = transaction || db;

      await dbClient
        .insert(auditLogTable)
        .values(auditLogData);

    } catch (error: any) {
      // Log error but don't fail the main operation
      console.error('[AuditLog] Failed to create audit log:', error.message);
    }
  }

  /**
   * Convert date string fields to Date objects for DateTime/Timestamp fields
   * This is needed because Drizzle expects Date objects for timestamp columns
   * Note: Date type (date-only) expects strings, not Date objects
   */
  private async convertDateFields(
    data: Record<string, any>,
    schemaDefinition: any
  ): Promise<void> {
    if (!schemaDefinition || !schemaDefinition.fields) {
      return;
    }

    const fields = schemaDefinition.fields;

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const fieldConfig = fieldDef as any;

      // Only convert DateTime/DateTime_NO_TZ/Timestamp to Date objects
      // Do NOT convert Date type (date-only) - it expects strings
      if (
        (fieldConfig.type === 'DateTime' || fieldConfig.type === 'DateTime_NO_TZ' || fieldConfig.type === 'Timestamp') &&
        data[fieldName] !== undefined &&
        data[fieldName] !== null
      ) {
        // Convert string to Date object if it's not already a Date
        if (typeof data[fieldName] === 'string') {
          const dateValue = new Date(data[fieldName]);
          if (!isNaN(dateValue.getTime())) {
            data[fieldName] = dateValue;
          }
        }
      }
    }
  }
}

export default ItemsService;
