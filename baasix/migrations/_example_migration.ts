/**
 * Example Migration: Add sample field
 * Version: 0.1.0-alpha.7
 * Type: schema
 * 
 * This is a template migration showing how to write migrations for Baasix.
 * Rename this file and update the version to use it.
 */

import type { MigrationContext, MigrationResult } from "../services/MigrationService.js";

export const version = "0.1.0-alpha.7";
export const name = "Example Schema Migration";
export const description = "Template showing how to write schema migrations";
export const type = "schema";

/**
 * Run the migration
 */
export async function up(context: MigrationContext): Promise<MigrationResult> {
  const { sql, log } = context;

  log("Running example migration...");

  // Example: Add a column to an existing table
  // Uncomment and modify as needed:
  //
  // await sql`
  //   ALTER TABLE "my_collection" 
  //   ADD COLUMN IF NOT EXISTS "new_field" TEXT DEFAULT 'default_value'
  // `;
  //
  // log("Added new_field column to my_collection");

  // Example: Create an index
  //
  // await sql`
  //   CREATE INDEX IF NOT EXISTS "idx_my_collection_new_field" 
  //   ON "my_collection" ("new_field")
  // `;
  //
  // log("Created index on new_field");

  // Example: Update existing data
  //
  // const result = await sql`
  //   UPDATE "my_collection" 
  //   SET "new_field" = 'migrated' 
  //   WHERE "new_field" IS NULL
  // `;
  //
  // log(`Updated ${result.count} records`);

  log("Example migration completed (no actual changes made)");

  return {
    success: true,
    message: "Example migration completed",
    metadata: {
      note: "This is a template migration - modify for your needs",
    },
  };
}

/**
 * Rollback the migration
 */
export async function down(context: MigrationContext): Promise<MigrationResult> {
  const { sql, log } = context;

  log("Rolling back example migration...");

  // Example: Remove the column added in up()
  //
  // await sql`
  //   ALTER TABLE "my_collection" 
  //   DROP COLUMN IF EXISTS "new_field"
  // `;
  //
  // log("Removed new_field column from my_collection");

  log("Example rollback completed (no actual changes made)");

  return {
    success: true,
    message: "Example rollback completed",
  };
}

export default { version, name, description, type, up, down };
