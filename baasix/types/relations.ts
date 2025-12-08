/**
 * Relation Types
 * Centralized relation and association type definitions
 */

import type { SQL } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { FilterObject } from './query.js';
import type { SortObject } from './sort.js';

/**
 * Association types matching Sequelize conventions
 */
export type AssociationType = 'HasMany' | 'BelongsTo' | 'HasOne' | 'BelongsToMany' | 'M2A';

/**
 * Relation types supported
 */
export type RelationType = 'BelongsTo' | 'HasOne' | 'HasMany' | 'BelongsToMany' | 'M2A';

/**
 * Association definition interface
 */
export interface AssociationDefinition {
  type: AssociationType;
  model: string;
  foreignKey?: string;
  otherKey?: string;
  through?: string;
  as?: string;
  polymorphic?: boolean;
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

/**
 * Include configuration for loading relations
 * Matches Sequelize include format
 */
export interface IncludeConfig {
  relation: string; // Relation name (e.g., 'author', 'posts')
  as?: string; // Alias for the relation
  required?: boolean; // INNER JOIN (true) vs LEFT JOIN (false)
  where?: FilterObject;
  attributes?: string[]; // Fields to select from related table
  include?: IncludeConfig[]; // Nested includes
  sort?: SortObject;
  limit?: number; // Limit related records (for HasMany)
  separate?: boolean; // Use separate query (for HasMany)
}

/**
 * Processed include with join information
 */
export interface ProcessedInclude {
  relation: string;
  relationType: RelationType;
  table: PgTable;
  joinCondition: SQL;
  where?: SQL | FilterObject;
  attributes: string[];
  nested: ProcessedInclude[];
  required: boolean;
  separate: boolean; // For HasMany separate queries
  alias?: string; // Optional alias for the relation
}

/**
 * Field expansion result with includes
 */
export interface ExpandedFieldsResult {
  directFields: string[]; // Direct fields on the main table
  includes: ProcessedInclude[]; // Relations to join/load
  relationPaths: Map<string, ProcessedInclude>; // Map of relation path to include
}

/**
 * Join definition to be applied to the query
 */
export interface JoinDefinition {
  table: any; // Drizzle table
  tableName: string; // Name of the table
  alias: string; // Unique alias for the table
  condition: SQL; // JOIN ON condition (Drizzle SQL object)
  conditionSQL: string; // Plain SQL string for the condition
  type: 'left' | 'inner' | 'right';
}

/**
 * Result of resolving a relation path
 */
export interface ResolvedPath {
  column: PgColumn | null; // The final column reference
  columnPath: string; // SQL path like "alias.columnName"
  joins: JoinDefinition[]; // Array of joins needed
  finalTable: any; // The table containing the final column
  finalAlias: string; // The alias of the table containing the final column
}

/**
 * Result of processing relational data
 */
export interface RelationalResult {
  result: Record<string, any>;
  deferredHasMany: Array<{ association: string; value: any; associationInfo: any }>;
  deferredM2M: Array<{ association: string; value: any; associationInfo: any }>;
  deferredM2A: Array<{ association: string; value: any; associationInfo: any }>;
}
