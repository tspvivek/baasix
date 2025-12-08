/**
 * Bootstrap Schema for Baasix
 * 
 * This file contains ONLY the baasix_SchemaDefinition table which is used to bootstrap
 * the dynamic schema management system. All other tables are created dynamically from
 * schema definitions stored in this table.
 * 
 * Flow:
 * 1. Create baasix_SchemaDefinition table (this file)
 * 2. Load system schemas from systemschema.ts into baasix_SchemaDefinition
 * 3. SchemaManager reads from baasix_SchemaDefinition and creates all tables dynamically
 */

import { pgTable, varchar, json, timestamp } from "drizzle-orm/pg-core";

/**
 * baasix_SchemaDefinition table - The only hardcoded table
 * This table stores JSON schema definitions for all other tables
 */
export const baasixSchemaDefinitionTable = pgTable("baasix_SchemaDefinition", {
  collectionName: varchar("collectionName", { length: 255 }).primaryKey().notNull(),
  schema: json("schema").$type<Record<string, any>>().notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow(),
});
