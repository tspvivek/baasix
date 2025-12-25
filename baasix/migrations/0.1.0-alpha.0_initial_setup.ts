/**
 * Initial Migration: System Initialization
 * Version: 0.1.0-alpha.0
 * Type: system
 * 
 * This is the base migration that marks the initial state of the system.
 * For fresh installations: This runs and marks the baseline.
 * For upgrades from Sequelize: This handles the fullName virtual field migration.
 */

import type { MigrationContext, MigrationResult } from "../services/MigrationService.js";

export const version = "0.1.0-alpha.0";
export const name = "Initial System Setup";
export const description = "Base migration marking the initial state of the Baasix system (Drizzle version). Handles Sequelize virtual field migration.";
export const type = "system";

/**
 * Run the migration
 */
export async function up(context: MigrationContext): Promise<MigrationResult> {
  const { log, sql } = context;

  log("Initial system migration - Baasix Drizzle Version");
  
  const metadata: Record<string, any> = {
    baasixVersion: "0.1.0-alpha.0",
    initialSetup: true,
  };

  // Check if this is a Sequelize upgrade by looking for fullName virtual field in schema
  try {
    const schemaCheck = await sql`
      SELECT schema->'fields'->'fullName' as fullname_field
      FROM "baasix_SchemaDefinition"
      WHERE "collectionName" = 'baasix_User'
    `;

    if (schemaCheck.length > 0 && schemaCheck[0].fullname_field) {
      const fieldDef = schemaCheck[0].fullname_field;
      
      // Check if it's a VIRTUAL type (Sequelize legacy)
      if (fieldDef && (fieldDef.type === 'VIRTUAL' || fieldDef.type === 'Virtual')) {
        log("Detected Sequelize VIRTUAL fullName field - removing from schema definition");
        
        // Remove the virtual fullName field from schema definition
        await sql`
          UPDATE "baasix_SchemaDefinition"
          SET schema = schema #- '{fields,fullName}'
          WHERE "collectionName" = 'baasix_User'
        `;
        
        log("Removed VIRTUAL fullName from baasix_User schema definition");
        metadata.removedVirtualFullName = true;
      }
    }
  } catch (error: any) {
    // If tables don't exist yet (fresh install), that's fine
    if (!error.message?.includes('does not exist')) {
      log(`Warning during Sequelize migration check: ${error.message}`);
    }
  }

  // Verify essential system tables exist
  const tablesCheck = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_name LIKE 'baasix_%'
    ORDER BY table_name
  `;

  const systemTables = tablesCheck.map((t: any) => t.table_name);
  log(`Found ${systemTables.length} baasix system tables`);
  metadata.systemTablesFound = systemTables;

  return {
    success: true,
    message: "Initial system setup complete",
    metadata,
  };
}

// No rollback for initial migration
export const down = undefined;

export default { version, name, description, type, up, down };
