/* eslint-disable no-case-declarations */
import { APIError } from "../utils/errorHandler.js";
import { db } from "../utils/db.js";
import { schemaManager } from "../utils/schemaManager.js";
import fileUpload from "express-fileupload";
import permissionService from "../services/PermissionService.js";
import { invalidateEntireCache } from "../services/CacheService.js";
import { adminOnly } from "../utils/auth.js";
import { like, ilike, or, and, eq, sql, SQL } from "drizzle-orm";
import type { Express } from "express";
import { ItemsService } from "../services/ItemsService.js";

const registerEndpoint = (app: Express, context?: any) => {
    async function validateRelationshipName(name, sourceCollection) {
        /*
        // Get all table names in the database
        const tables = await sequelize.getQueryInterface().showAllTables();

        // Check if the relationship name matches any table name
        if (tables.includes(name)) {
            throw new APIError(`Relationship name '${name}' cannot be the same as an existing table name`, 400);
        }
        */

        // Check if the relationship name is the same as the source collection
        if (name === sourceCollection) {
            throw new APIError(
                `Relationship name '${name}' cannot be the same as the collection name ${sourceCollection}`,
                400
            );
        }

        // Check if the name is a reserved word in PostgreSQL
        const reservedWords = [
            "user",
            "group",
            "order",
            "limit",
            "offset",
            "where",
            "select",
            "insert",
            "update",
            "delete",
            "table",
            "from",
            "join",
            "left",
            "right",
            "inner",
            "outer",
            "cross",
            "natural",
            "using",
            "on",
        ];

        if (reservedWords.includes(name.toLowerCase())) {
            throw new APIError(`Relationship name '${name}' cannot be a reserved word`, 400);
        }
    }

    // Helper function to fetch schema definition by collection name
    async function getSchemaDefinition(collectionName: string, accountability?: any): Promise<any> {
        const schemaService = new ItemsService('baasix_SchemaDefinition', { accountability });
        const result = await schemaService.readByQuery({
            filter: { collectionName },
            limit: 1
        }, true);
        return result.data[0] || null;
    }

    // Get all schemas
    // Access controlled by SCHEMAS_PUBLIC env variable:
    // - true (default): Bypass permission check (for development/CLI)
    // - false: Requires permission on baasix_SchemaDefinition (production)
    // Admins always have access via ItemsService
    app.get("/schemas", async (req, res, next) => {
        try {
            console.log('[schema.route] GET /schemas called');
            const { search, page, limit, sort = "collectionName:asc" } = req.query as any;

            // Default to public access (backwards compatible), set SCHEMAS_PUBLIC=false for production
            const bypassPermissions = process.env.SCHEMAS_PUBLIC !== 'false';

            // Use ItemsService - bypasses permission if public, otherwise checks permission
            const schemaService = new ItemsService('baasix_SchemaDefinition', {
                accountability: req.accountability as any
            });

            const query: any = {
                fields: ['collectionName', 'schema']
            };

            // Only add sort if provided and not the default format that causes parsing issues
            if (sort && typeof sort === 'string' && sort.includes(':')) {
                const [field, direction] = sort.split(':');
                query.sort = [direction?.toLowerCase() === 'desc' ? `-${field}` : field];
            }

            if (search) {
                query.search = search;
                query.searchFields = ['collectionName'];
            }

            if (page !== undefined || limit !== undefined) {
                query.page = parseInt(page || 1, 10);
                query.limit = parseInt(limit || 50, 10);
            }

            const result = await schemaService.readByQuery(query, bypassPermissions);
            
            // Transform to expected format
            const schemas = result.data.map((item: any) => ({
                collectionName: item.collectionName,
                schema: item.schema
            }));

            if (page !== undefined || limit !== undefined) {
                const pageNum = parseInt(page || 1, 10);
                const limitNum = parseInt(limit || 50, 10);
                const totalPages = Math.ceil((result.totalCount || 0) / limitNum);
                
                return res.status(200).json({
                    data: schemas,
                    totalCount: result.totalCount || schemas.length,
                    pagination: {
                        currentPage: pageNum,
                        totalPages,
                        limit: limitNum,
                        hasNextPage: pageNum < totalPages,
                        hasPrevPage: pageNum > 1,
                        nextPage: pageNum < totalPages ? pageNum + 1 : null,
                        prevPage: pageNum > 1 ? pageNum - 1 : null
                    }
                });
            }

            return res.status(200).json({
                data: schemas,
                totalCount: schemas.length
            });
        } catch (error: any) {
            console.error('[schema.route] Error in GET /schemas:', error);
            next(error);
        }
    });

    // Get a specific schema
    // Access controlled same as GET /schemas
    app.get("/schemas/:collectionName", async (req, res, next) => {
        try {
            // Default to public access (backwards compatible), set SCHEMAS_PUBLIC=false for production
            const bypassPermissions = process.env.SCHEMAS_PUBLIC !== 'false';

            // Use ItemsService - bypasses permission if public, otherwise checks permission
            const schemaService = new ItemsService('baasix_SchemaDefinition', {
                accountability: req.accountability as any
            });

            const result = await schemaService.readByQuery({
                filter: { collectionName: { eq: req.params.collectionName } },
                limit: 1,
                fields: ['collectionName', 'schema']
            }, bypassPermissions);

            if (!result.data || result.data.length === 0) {
                throw new APIError("Schema not found", 404);
            }

            return res.status(200).json({
                data: {
                    collectionName: result.data[0].collectionName,
                    schema: result.data[0].schema
                }
            });
        } catch (error) {
            next(error);
        }
    });

    // Process schema to handle special flags like usertrack, sortEnabled
    function processSchemaFlags(schema, editMode = false) {
        // Deep clone to avoid mutations
        const processedSchema = JSON.parse(JSON.stringify(schema));
        
        // Ensure fields object exists
        if (!processedSchema.fields) {
            processedSchema.fields = {};
        }

        // Handle usertrack flag
        if (processedSchema.usertrack === true) {
            const usertrack = {
                userCreated_Id: { type: "UUID", SystemGenerated: true },
                userCreated: {
                    relType: "BelongsTo",
                    target: "baasix_User",
                    foreignKey: "userCreated_Id",
                    as: "userCreated",
                    SystemGenerated: true,
                    description: "M2O",
                },
                userUpdated_Id: { type: "UUID", SystemGenerated: true },
                userUpdated: {
                    relType: "BelongsTo",
                    target: "baasix_User",
                    foreignKey: "userUpdated_Id",
                    as: "userUpdated",
                    SystemGenerated: true,
                    description: "M2O",
                },
            };

            processedSchema.fields = { ...processedSchema.fields, ...usertrack };
        }

        // Handle sortEnabled flag
        if (processedSchema.sortEnabled === true) {
            processedSchema.fields = {
                ...processedSchema.fields,
                sort: {
                    type: "Integer",
                    allowNull: true,
                    description: "Sort order for items",
                    SystemGenerated: true
                },
            };
        }

        if (editMode) {
            // If sortEnabled is enabled, ensure the sort field is added
            if (processedSchema.sortEnabled === true) {
                processedSchema.fields.sort = {
                    type: "Integer",
                    allowNull: true,
                    description: "Sort order for items",
                    SystemGenerated: true
                };
            }
            // Note: If sortEnabled is disabled, we don't remove the sort field, just keep it

            // If timestamps are enabled, ensure they are not removed
            if (processedSchema.timestamps === true) {
                processedSchema.fields = {
                    ...processedSchema.fields,
                    createdAt: { type: "DateTime", allowNull: true, SystemGenerated: true, defaultValue: { type: "NOW" } },
                    updatedAt: { type: "DateTime", allowNull: true, SystemGenerated: true, defaultValue: { type: "NOW" } },
                };
            } else if (processedSchema.timestamps === false) {
                // If timestamps are explicitly disabled, remove them from the schema
                delete processedSchema.fields.createdAt;
                delete processedSchema.fields.updatedAt;
            }

            // If paranoid is enabled, ensure it is not removed
            if (processedSchema.paranoid === true) {
                processedSchema.fields.deletedAt = { type: "DateTime", allowNull: true, SystemGenerated: true, defaultValue: { type: "NOW" } };
            } else if (processedSchema.paranoid === false) {
                delete processedSchema.fields.deletedAt;
            }
        }

        return processedSchema;
    }

    app.post("/schemas", adminOnly, async (req, res, next) => {
        try {
            console.log("Creating new schema");
            const { collectionName, schema } = req.body;

            // Process schema flags
            const processedSchema = processSchemaFlags(schema);

            //Return error if collectionName is not provided or ends with _junction
            if (!collectionName || collectionName.endsWith("_junction")) {
                throw new APIError(
                    "Invalid collection name",
                    400,
                    "Collection name cannot be empty or end with _junction"
                );
            }

            // Insert into baasix_SchemaDefinition table
            const schemaDefTable = schemaManager.getTable("baasix_SchemaDefinition");
            await db.insert(schemaDefTable).values({
                collectionName,
                schema: processedSchema,
            });

            // Update in-memory schema (creates Drizzle table)
            await schemaManager.updateModel(collectionName, processedSchema, req.accountability);

            // Invalidate schema definition cache after creating schema
            await invalidateEntireCache('baasix_SchemaDefinition');

            // Sync realtime if the new schema has realtime enabled
            const hasRealtime = processedSchema.realtime === true || 
                (typeof processedSchema.realtime === 'object' && processedSchema.realtime?.enabled);
            if (hasRealtime) {
                try {
                    const realtimeService = (await import('../services/RealtimeService.js')).default;
                    if (realtimeService.isWalAvailable()) {
                        await realtimeService.reloadCollections([collectionName]);
                    }
                } catch (error) {
                    console.warn('Could not sync realtime configuration:', error.message);
                }
            }

            console.log("Schema created successfully");
            res.status(201).json({ message: "Schema created successfully" });
        } catch (error) {
            console.error("Error creating schema:", error);
            next(new APIError("Error creating schema", 500, error.message));
        }
    });

    app.patch("/schemas/:collectionName", adminOnly, async (req, res, next) => {
        try {
            console.log(`Updating schema for ${req.params.collectionName}`);
            console.log("New schema:", JSON.stringify(req.body.schema, null, 2));
            const { collectionName } = req.params;
            const { schema } = req.body;

            // Get existing schema to compare flags
            const schemaDefTable = schemaManager.getTable("baasix_SchemaDefinition");
            const existingSchemaRecords = await db
                .select()
                .from(schemaDefTable)
                .where(eq(schemaDefTable.collectionName, collectionName))
                .limit(1);

            if (!existingSchemaRecords || existingSchemaRecords.length === 0) {
                throw new APIError("Schema not found", 404);
            }

            const existingSchema = existingSchemaRecords[0].schema;

            // Check for changes in special flags
            const flagsChanged =
                existingSchema.usertrack !== schema.usertrack ||
                existingSchema.sortEnabled !== schema.sortEnabled ||
                existingSchema.timestamps !== schema.timestamps ||
                existingSchema.paranoid !== schema.paranoid;

            // Check if realtime config changed
            const realtimeChanged = !deepEqual(existingSchema.realtime, schema.realtime);

            console.log(`Flags changed: ${flagsChanged}`);

            // Process schema flags
            const processedSchema = processSchemaFlags(schema, true);

            // If usertrack was disabled, we don't remove the fields, just keep them
            // If sortEnabled was disabled, we don't remove the sort field, just keep it

            // Update in database
            await db
                .update(schemaDefTable)
                .set({ schema: processedSchema, updatedAt: new Date() })
                .where(eq(schemaDefTable.collectionName, collectionName));

            // Update in-memory schema
            await schemaManager.updateModel(collectionName, processedSchema, req.accountability);

            // Invalidate schema definition cache after updating schema
            await invalidateEntireCache('baasix_SchemaDefinition');

            // Sync realtime if the config changed
            if (realtimeChanged) {
                console.log(`Realtime config changed for ${collectionName}, syncing...`);
                console.log(`  Old: ${JSON.stringify(existingSchema.realtime)}`);
                console.log(`  New: ${JSON.stringify(schema.realtime)}`);
                try {
                    const realtimeService = (await import('../services/RealtimeService.js')).default;
                    if (realtimeService.isWalAvailable()) {
                        await realtimeService.reloadCollections([collectionName]);
                        console.log(`Realtime configuration synced for ${collectionName}`);
                    } else {
                        console.log(`WAL not available, skipping realtime sync for ${collectionName}`);
                    }
                } catch (error) {
                    console.warn('Could not sync realtime configuration:', error.message);
                }
            }

            console.log(`Schema for ${collectionName} updated successfully`);
            res.status(200).json({ message: "Schema updated successfully" });
        } catch (error) {
            console.error("Error updating schema:", error);
            next(new APIError("Error updating schema", 500, error.message));
        }
    });

    app.delete("/schemas/:collectionName", adminOnly, async (req, res, next) => {
        try {
            console.log("Deleting schema");
            const { collectionName } = req.params;

            // Delete from database
            const schemaDefTable = schemaManager.getTable("baasix_SchemaDefinition");
            await db
                .delete(schemaDefTable)
                .where(eq(schemaDefTable.collectionName, collectionName));

            // Delete from memory
            await (schemaManager as any).deleteModel(collectionName, req.accountability);

            // Invalidate schema definition cache after deleting schema
            await invalidateEntireCache('baasix_SchemaDefinition');

            // Remove from realtime publication if it was enabled
            try {
                const realtimeService = (await import('../services/RealtimeService.js')).default;
                if (realtimeService.isWalAvailable()) {
                    await realtimeService.reloadCollections([collectionName]);
                }
            } catch (error) {
                console.warn('Could not sync realtime configuration:', error.message);
            }

            console.log("Schema deleted successfully");
            res.status(200).json({ message: "Schema deleted successfully" });
        } catch (error) {
            console.error("Error deleting schema:", error);
            next(new APIError("Error deleting schema", 500, error.message));
        }
    });

    // Add index
    app.post("/schemas/:collectionName/indexes", adminOnly, async (req, res, next) => {
        try {
            const { collectionName } = req.params;
            const indexDefinition = req.body;

            await schemaManager.addIndex(collectionName, indexDefinition, req.accountability);

            // Invalidate schema definition cache after adding index
            await invalidateEntireCache('baasix_SchemaDefinition');

            res.status(201).json({ message: "Index added successfully" });
        } catch (error) {
            next(new APIError("Error adding index", 500, error.message));
        }
    });

    // Remove index
    app.delete("/schemas/:collectionName/indexes/:indexName", adminOnly, async (req, res, next) => {
        try {
            const { collectionName, indexName } = req.params;

            await (schemaManager as any).removeIndex(collectionName, indexName, req.accountability);

            // Invalidate schema definition cache after removing index
            await invalidateEntireCache('baasix_SchemaDefinition');

            res.status(200).json({ message: "Index removed successfully" });
        } catch (error) {
            next(new APIError("Error removing index", 500, error.message));
        }
    });

    // Create relationship endpoint
    app.post("/schemas/:sourceCollection/relationships", adminOnly, async (req, res, next) => {
        try {
            const { sourceCollection } = req.params;
            const relationshipData = req.body;

            // Validate input
            if (!["M2O", "O2O", "M2M", "M2A", "O2M"].includes(relationshipData.type)) {
                throw new APIError("Invalid relationship type. Must be M2O, O2M, O2O, M2M, or M2A", 400);
            }

            // Validate relationship name
            await validateRelationshipName(relationshipData.name, sourceCollection);

            // If there's an alias, validate it too
            if (relationshipData.alias && relationshipData.target) {
                await validateRelationshipName(relationshipData.alias, relationshipData.target);
            }

            // Get existing schemas
            const sourceSchemaDoc = await getSchemaDefinition(sourceCollection, req.accountability);
            const sourceSchema = sourceSchemaDoc?.schema;

            if (relationshipData.type == "M2A") {
                if (!sourceSchema) {
                    throw new APIError("Source or target collection not found", 404);
                }

                // Process the relationship
                const { updatedSourceSchema } = await processRelationship(
                    sourceCollection,
                    sourceSchema,
                    null,
                    relationshipData,
                    req.accountability,
                    false
                );

                // Apply schema updates
                await schemaManager.updateModel(sourceCollection, updatedSourceSchema, req.accountability);
            } else {
                const targetSchemaDoc = await getSchemaDefinition(relationshipData.target, req.accountability);
            const targetSchema = targetSchemaDoc?.schema;

                if (!sourceSchema || !targetSchema) {
                    throw new APIError("Source or target collection not found", 404);
                }

                //Check if the relationship is self-referential
                const isSelfReferential = sourceCollection === relationshipData.target;

                // Process the relationship
                const { updatedSourceSchema, updatedTargetSchema } = await processRelationship(
                    sourceCollection,
                    sourceSchema,
                    targetSchema,
                    relationshipData,
                    req.accountability,
                    isSelfReferential
                );

                // Apply schema updates
                console.log(`[processRelationship] Applying schema updates for ${sourceCollection}`);
                console.log(`[processRelationship] Updated source schema fields:`, Object.keys(updatedSourceSchema.fields));
                await schemaManager.updateModel(sourceCollection, updatedSourceSchema, req.accountability);
                if (updatedTargetSchema && !isSelfReferential) {
                    console.log(`[processRelationship] Applying schema updates for ${relationshipData.target}`);
                    console.log(`[processRelationship] Updated target schema fields:`, Object.keys(updatedTargetSchema.fields));
                    await schemaManager.updateModel(relationshipData.target, updatedTargetSchema, req.accountability);
                }
            }

            // Invalidate schema definition cache after creating relationship
            // This ensures the updated schema with new fields is fetched fresh
            await invalidateEntireCache('baasix_SchemaDefinition');

            res.status(201).json({ message: "Relationship created successfully" });
        } catch (error) {
            console.error("Error creating relationship:", error);
            next(new APIError("Error creating relationship", 500, error.message));
        }
    });

    // Update relationship endpoint
    app.patch("/schemas/:sourceCollection/relationships/:fieldName", adminOnly, async (req, res, next) => {
        try {
            const { sourceCollection, fieldName } = req.params;
            const updateData = req.body;

            const sourceSchemaDoc = await getSchemaDefinition(sourceCollection, req.accountability);
            const sourceSchema = sourceSchemaDoc?.schema;

            if (!sourceSchema.fields[fieldName]) {
                throw new APIError("Relationship field not found", 404);
            }

            const updatedField = { ...sourceSchema.fields[fieldName], ...updateData };

            // If it's an M2A relationship and tables are being added or removed
            if (updatedField.relType === "HasMany" && updatedField.polymorphic && updateData.tables) {
                // Pass the original field data (before update) to determine what actually changed
                await updateM2ARelationship(
                    sourceCollection,
                    fieldName,
                    updateData.tables,
                    sourceSchema.fields[fieldName], // Pass original field data
                    updatedField, // Pass updated field data for new values
                    req.accountability
                );
            }

            // Update the source schema field AFTER processing M2A changes
            sourceSchema.fields[fieldName] = updatedField;

            await schemaManager.updateModel(sourceCollection, sourceSchema, req.accountability);

            // Update the reverse relationship if it exists
            if (updatedField.target) {
                const targetSchemaDoc = await getSchemaDefinition(updatedField.target, req.accountability);
            const targetSchema = targetSchemaDoc?.schema;
                const reverseField = Object.entries(targetSchema.fields).find(
                    ([, field]: [string, any]) => field.target === sourceCollection && field.foreignKey === fieldName
                );
                if (reverseField) {
                    const [reverseFieldName, reverseFieldData] = reverseField;
                    targetSchema.fields[reverseFieldName] = {
                        ...(reverseFieldData as any),
                        onDelete: updateData.onDelete,
                        onUpdate: updateData.onUpdate,
                    };
                    await schemaManager.updateModel(updatedField.target, targetSchema, req.accountability);
                }
            }

            // Invalidate schema definition cache after updating relationship
            await invalidateEntireCache('baasix_SchemaDefinition');

            res.status(200).json({ message: "Relationship updated successfully" });
        } catch (error) {
            console.error("Error updating relationship:", error);
            next(new APIError("Error updating relationship", 500, error.message));
        }
    });

    // Delete relationship endpoint
    app.delete("/schemas/:sourceCollection/relationships/:fieldName", adminOnly, async (req, res, next) => {
        try {
            const { sourceCollection, fieldName } = req.params;

            const sourceSchemaDoc = await getSchemaDefinition(sourceCollection, req.accountability);
            const sourceSchema = sourceSchemaDoc?.schema;
            if (!sourceSchema.fields[fieldName]) {
                throw new APIError("Relationship field not found", 404);
            }

            const fieldData = sourceSchema.fields[fieldName];

            //if foreign key exists, delete it
            if (
                sourceSchema.fields[fieldData.foreignKey] &&
                sourceSchema.fields[fieldData.foreignKey].SystemGenerated
            ) {
                delete sourceSchema.fields[fieldData.foreignKey];
            }

            delete sourceSchema.fields[fieldName];

            await schemaManager.updateModel(sourceCollection, sourceSchema, req.accountability);

            // Remove the reverse relationship if it exists
            if (fieldData.target) {
                const targetSchemaDoc = await getSchemaDefinition(fieldData.target, req.accountability);
            const targetSchema = targetSchemaDoc?.schema;
                const reverseField = Object.entries(targetSchema.fields).find(
                    ([, field]: [string, any]) => field.target === sourceCollection && field.foreignKey === fieldData.foreignKey
                );
                if (reverseField) {
                    const [reverseFieldName] = reverseField;
                    delete targetSchema.fields[reverseFieldName];
                    await schemaManager.updateModel(fieldData.target, targetSchema, req.accountability);
                }
            }

            //If it's an M2M relationship, delete the through table
            if (fieldData.relType === "BelongsToMany" && fieldData.through) {
                //Delete the through table from the database
                await db.execute(sql`DROP TABLE IF EXISTS ${sql.raw(`"${fieldData.through}"`)}`);

                // Delete schema definition
                const schemaToDelete = await getSchemaDefinition(fieldData.through, req.accountability);
                if (schemaToDelete) {
                    const schemaDefService = new ItemsService('baasix_SchemaDefinition', { accountability: req.accountability as any });
                    await schemaDefService.deleteOne(schemaToDelete.id);
                }
            }

            // Invalidate schema definition cache after deleting relationship
            await invalidateEntireCache('baasix_SchemaDefinition');

            res.status(200).json({ message: "Relationship deleted successfully" });
        } catch (error) {
            next(new APIError("Error deleting relationship", 500, error.message));
        }
    });

    async function processRelationship(
        sourceCollection,
        sourceSchema,
        targetSchema,
        relationshipData,
        accountability,
        isSelfReferential
    ) {
        const updatedSourceSchema = { ...sourceSchema };
        let updatedTargetSchema = { ...targetSchema };

        const { onDelete, onUpdate } = relationshipData;

        console.log("Processing relationship", sourceSchema);

        switch (relationshipData.type) {
            case "O2M":
                updatedSourceSchema.fields[relationshipData.name] = {
                    relType: "HasMany",
                    target: relationshipData.target,
                    foreignKey: relationshipData.foreignKey,
                    as: relationshipData.name,
                    description: relationshipData.description,
                    onDelete,
                    onUpdate,
                };

                break;
            case "M2O":
                // Use provided foreignKey or default to name + "_id"
                const m2oForeignKey = relationshipData.foreignKey || (relationshipData.name + "_id");

                updatedSourceSchema.fields[relationshipData.name] = {
                    relType: "BelongsTo",
                    target: relationshipData.target,
                    foreignKey: m2oForeignKey,
                    as: relationshipData.name,
                    description: relationshipData.description,
                    onDelete,
                    onUpdate,
                };

                //Add foreign key to source collection, fetching type from target collection schema
                // Find the actual primary key field in the target schema
                const targetPrimaryKeyField = Object.entries(targetSchema.fields).find(
                    ([, field]: [string, any]) => field.primaryKey === true
                );
                const targetPrimaryKeyName = targetPrimaryKeyField ? targetPrimaryKeyField[0] : 'id';
                const targetPrimaryKeyType = targetSchema.fields[targetPrimaryKeyName]?.type || 'UUID';

                updatedSourceSchema.fields[m2oForeignKey] = {
                    type: targetPrimaryKeyType,
                    allowNull: true,
                    SystemGenerated: true,
                };

                if (relationshipData.alias) {
                    if (isSelfReferential) {
                        updatedSourceSchema.fields[relationshipData.alias] = {
                            relType: "HasMany",
                            target: sourceCollection,
                            foreignKey: m2oForeignKey,
                            as: relationshipData.alias,
                            description: relationshipData.description + " Alias",
                            onDelete,
                            onUpdate,
                        };
                    } else {
                        updatedTargetSchema.fields[relationshipData.alias] = {
                            relType: "HasMany",
                            target: sourceCollection,
                            foreignKey: m2oForeignKey,
                            as: relationshipData.alias,
                            description: relationshipData.description + " Alias",
                            onDelete,
                            onUpdate,
                        };
                    }
                }
                break;

            case "O2O":
                // Use provided foreignKey or default to name + "_id"
                const o2oForeignKey = relationshipData.foreignKey || (relationshipData.name + "_id");

                updatedSourceSchema.fields[relationshipData.name] = {
                    relType: "BelongsTo",
                    target: relationshipData.target,
                    foreignKey: o2oForeignKey,
                    as: relationshipData.name,
                    description: relationshipData.description,
                    onDelete,
                    onUpdate,
                };

                //Add foreign key to source collection, fetching type from target collection schema
                // Find the actual primary key field in the target schema
                const o2oTargetPrimaryKeyField = Object.entries(targetSchema.fields).find(
                    ([, field]: [string, any]) => field.primaryKey === true
                );
                const o2oTargetPrimaryKeyName = o2oTargetPrimaryKeyField ? o2oTargetPrimaryKeyField[0] : 'id';
                const o2oTargetPrimaryKeyType = targetSchema.fields[o2oTargetPrimaryKeyName]?.type || 'UUID';

                updatedSourceSchema.fields[o2oForeignKey] = {
                    type: o2oTargetPrimaryKeyType,
                    allowNull: true,
                    SystemGenerated: true,
                };

                if (relationshipData.alias) {
                    if (isSelfReferential) {
                        updatedSourceSchema.fields[relationshipData.alias] = {
                            relType: "HasOne",
                            target: sourceCollection,
                            foreignKey: o2oForeignKey,
                            as: relationshipData.alias,
                            description: relationshipData.description + " Alias",
                            onDelete,
                            onUpdate,
                        };
                    } else {
                        updatedTargetSchema.fields[relationshipData.alias] = {
                            relType: "HasOne",
                            target: sourceCollection,
                            foreignKey: o2oForeignKey,
                            as: relationshipData.alias,
                            description: relationshipData.description + " Alias",
                            onDelete,
                            onUpdate,
                        };
                    }
                }
                break;

            case "M2M":
                let through = `${sourceCollection}_${relationshipData.target}_${relationshipData.name}_junction`;

                const sourceType = sourceSchema.fields.id.type;
                const targetType = targetSchema.fields.id.type;

                // For self-referential M2M relationships, add _2 suffix to avoid column name conflicts
                const sourceIdColumn = `${sourceCollection}_id`;
                const targetIdColumn = isSelfReferential
                    ? `${relationshipData.target}_id_2`
                    : `${relationshipData.target}_id`;

                const throughSchema = {
                    name: through,
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        [sourceIdColumn]: { type: sourceType, allowNull: false, SystemGenerated: true },
                        [targetIdColumn]: {
                            type: targetType,
                            allowNull: false,
                            SystemGenerated: true,
                        },
                        [sourceCollection]: {
                            relType: "BelongsTo",
                            target: sourceCollection,
                            foreignKey: sourceIdColumn,
                            description: "M2M Junction",
                            SystemGenerated: true,
                        },
                        [isSelfReferential ? `${relationshipData.target}_2` : relationshipData.target]: {
                            relType: "BelongsTo",
                            target: relationshipData.target,
                            foreignKey: targetIdColumn,
                            description: "M2M Junction",
                            SystemGenerated: true,
                        },
                    },
                    timestamps: true,
                    indexes: [
                        {
                            name: `${sourceCollection}_${relationshipData.target}_unique`,
                            fields: [sourceIdColumn, targetIdColumn],
                            unique: true,
                        },
                    ],
                };

                await schemaManager.updateModel(through, throughSchema, accountability);

                // Add HasMany from source to junction
                updatedSourceSchema.fields[relationshipData.name] = {
                    relType: "HasMany",
                    target: through,
                    foreignKey: sourceIdColumn,
                    as: relationshipData.name,
                    description: relationshipData.description,
                    onDelete,
                    onUpdate,
                };

                if (relationshipData.alias) {
                    if (isSelfReferential) {
                        updatedSourceSchema.fields[relationshipData.alias] = {
                            relType: "HasMany",
                            target: through,
                            foreignKey: targetIdColumn,
                            as: relationshipData.alias,
                            description: relationshipData.description,
                            onDelete,
                            onUpdate,
                        };
                    } else {
                        updatedTargetSchema.fields[relationshipData.alias] = {
                            relType: "HasMany",
                            target: through,
                            foreignKey: targetIdColumn,
                            as: relationshipData.alias,
                            description: relationshipData.description,
                            onDelete,
                            onUpdate,
                        };
                    }
                }

                break;

            case "M2A":
                let throughTable = `${sourceCollection}_${relationshipData.name}_junction`;

                //Check type of id in all target tables to ensure they are the same
                const firstTableSchemaDoc = await getSchemaDefinition(relationshipData.tables[0], accountability);
            const firstTableSchema = firstTableSchemaDoc?.schema;

                console.log("First table schema", firstTableSchema);

                if (!firstTableSchema) {
                    throw new APIError("Target table not found", 404);
                }

                for (const table of relationshipData.tables) {
                    const tableSchemaDoc = await getSchemaDefinition(table, accountability);
            const tableSchema = tableSchemaDoc?.schema;

                    if (tableSchema.fields.id.type !== firstTableSchema.fields.id.type) {
                        throw new APIError("Target tables must have the same id type", 400);
                    }
                }

                // Create through table schema
                const throughSchemaM2A = {
                    name: throughTable,
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        [`${sourceCollection}_id`]: {
                            type: sourceSchema.fields.id.type,
                            allowNull: false,
                            SystemGenerated: true,
                        },
                        item_id: {
                            type: firstTableSchema.fields.id.type,
                            allowNull: false,
                            references: null,
                            SystemGenerated: true,
                            constraints: false,
                        },
                        collection: {
                            type: "String",
                            allowNull: false,
                            SystemGenerated: true,
                        },
                        [sourceCollection]: {
                            relType: "BelongsTo",
                            target: sourceCollection,
                            foreignKey: `${sourceCollection}_id`,
                            description: "M2A Junction Source",
                            SystemGenerated: true,
                        },
                    },
                    indexes: [
                        {
                            name: `${sourceCollection}_${relationshipData.name}_unique`,
                            fields: [`${sourceCollection}_id`, "item_id", "collection"],
                            unique: true,
                        },
                    ],
                    timestamps: true,
                    constraints: false,
                };

                for (const table of relationshipData.tables) {
                    //Add one to many polymorphic relation from junction table to target tables.
                    throughSchemaM2A.fields[table] = {
                        relType: "BelongsTo",
                        description: "M2A Junction Target",
                        target: table,
                        foreignKey: "item_id",
                        as: table,
                        constraints: false,
                        SystemGenerated: true,
                    } as any;
                }

                // Create through table
                await schemaManager.updateModel(throughTable, throughSchemaM2A, accountability);

                for (const table of relationshipData.tables) {
                    // Add HasMany relation from target to junction table
                    const targetSchemaDoc = await getSchemaDefinition(table, accountability);
            const targetSchema = targetSchemaDoc?.schema;

                    targetSchema.fields[relationshipData.alias] = {
                        relType: "HasMany",
                        target: throughTable,
                        foreignKey: "item_id",
                        as: relationshipData.alias,
                        description: relationshipData.description,
                        constraints: false,
                        scope: {
                            collection: table.toLowerCase(),
                        },
                        onDelete,
                        onUpdate,
                    };
                }

                // Add HasMany relation from source to junction table
                console.log(`[processRelationship] Adding M2A field '${relationshipData.name}' to ${sourceCollection}`);
                updatedSourceSchema.fields[relationshipData.name] = {
                    relType: "HasMany",
                    target: throughTable,
                    foreignKey: `${sourceCollection}_id`,
                    as: relationshipData.name,
                    description: relationshipData.description,
                    tables: relationshipData.tables,
                    polymorphic: true,
                    onDelete,
                    onUpdate,
                };
                console.log(`[processRelationship] Updated source schema fields for ${sourceCollection}:`, Object.keys(updatedSourceSchema.fields));

                break;
        }

        return { updatedSourceSchema, updatedTargetSchema };
    }

    async function updateM2ARelationship(sourceCollection, fieldName, newTables, originalFieldData, updatedFieldData, accountability) {
        console.log("Updating M2A relationship for", sourceCollection, fieldName, newTables);

        const sourceSchemaDoc = await getSchemaDefinition(sourceCollection, accountability);
            const sourceSchema = sourceSchemaDoc?.schema;

        const throughTable = `${sourceCollection}_${fieldName}_junction`;

        // Check type of id in all target tables to ensure they are the same
        const firstTableSchemaDoc = await getSchemaDefinition(newTables[0], accountability);
            const firstTableSchema = firstTableSchemaDoc?.schema;

        if (!firstTableSchema) {
            throw new APIError("Target table not found", 404);
        }

        for (const table of newTables) {
            const tableSchemaDoc = await getSchemaDefinition(table, accountability);
            const tableSchema = tableSchemaDoc?.schema;

            if (tableSchema.fields.id.type !== firstTableSchema.fields.id.type) {
                throw new APIError("Target tables must have the same id type", 400);
            }
        }

        // Get current tables from the existing M2A relationship
        const currentTables = originalFieldData.tables || [];

        console.log(`Current tables in M2A relationship: ${currentTables}`);

        // Determine which tables are being added and removed
        const tablesToAdd = newTables.filter((table) => !currentTables.includes(table));
        const tablesToRemove = currentTables.filter((table) => !newTables.includes(table));

        // Check if there's existing data that would be orphaned by removing tables
        if (tablesToRemove.length > 0) {
            try {
                const junctionService = new ItemsService(throughTable, { accountability });
                for (const table of tablesToRemove) {
                    const result = await junctionService.readByQuery({
                        filter: { collection: table.toLowerCase() },
                        aggregate: { count: { function: 'count', field: 'id' } },
                        limit: 0
                    }, true);

                    const existingCount = result.data?.[0]?.count || 0;
                    if (existingCount > 0) {
                        throw new APIError(
                            `Cannot remove table '${table}' from M2A relationship because there are ${existingCount} existing records. Please clean up the data first.`,
                            400
                        );
                    }
                }
            } catch (error: any) {
                // If table doesn't exist yet, that's fine - no data to validate
                if (!error.message?.includes('does not exist')) {
                    throw error;
                }
            }
        }

        // Also check if there's existing data that would violate new table constraints
        if (tablesToAdd.length > 0) {
            try {
                const junctionService = new ItemsService(throughTable, { accountability });
                // Get all existing data in the junction table
                const existingDataResult = await junctionService.readByQuery({
                    fields: ['item_id', 'collection'],
                    limit: -1
                }, true);
                const existingData = existingDataResult.data;

                // Check if any existing data references tables that aren't in newTables
                for (const record of existingData) {
                    if (!newTables.map((t: any) => t.toLowerCase()).includes(record.collection)) {
                        throw new APIError(
                            `Cannot update M2A relationship because there is existing data referencing table '${record.collection}' which is not in the new table list. Please clean up the data first.`,
                            400
                        );
                    }
                }

                // Check if existing data has valid references to the new tables being added
                for (const table of tablesToAdd) {
                    try {
                        const tableService = new ItemsService(table, { accountability });
                        const recordsForTable = existingData.filter((r: any) => r.collection === table.toLowerCase());
                        for (const record of recordsForTable) {
                            const result = await tableService.readByQuery({
                                filter: { id: record.item_id },
                                aggregate: { count: { function: 'count', field: 'id' } },
                                limit: 0
                            }, true);
                            const exists = result.data?.[0]?.count || 0;
                            if (!exists) {
                                throw new APIError(
                                    `Cannot add table '${table}' to M2A relationship because junction table contains item_id=${record.item_id} which doesn't exist in table '${table}'. Please clean up the data first.`,
                                    400
                                );
                            }
                        }
                    } catch (error: any) {
                        // If target table doesn't exist, skip validation for it
                        if (!error.message?.includes('does not exist')) {
                            throw error;
                        }
                    }
                }
            } catch (error: any) {
                // If junction table doesn't exist yet, that's fine - no data to validate
                if (!error.message?.includes('does not exist')) {
                    throw error;
                }
            }
        }

        // Remove relationship from tables no longer in the list
        for (const table of tablesToRemove) {
            // Remove the inverse relationship from the target table
            const targetSchemaDoc = await getSchemaDefinition(table, accountability);
            const targetSchema = targetSchemaDoc?.schema;
            if (targetSchema.fields[originalFieldData.alias]) {
                delete targetSchema.fields[originalFieldData.alias];
                await schemaManager.updateModel(table, targetSchema, accountability);
            }
        }

        // Get the existing junction table schema to preserve existing structure
        const existingJunctionSchema = await getSchemaDefinition(throughTable, accountability);

        if (!existingJunctionSchema) {
            throw new APIError(`Junction table ${throughTable} not found. Cannot update M2A relationship on non-existent table.`, 404);
        }

        console.log(`Updating M2A junction table ${throughTable}: adding ${tablesToAdd.length} tables, removing ${tablesToRemove.length} tables`);

        // Preserve existing schema completely and only modify table relationships
        // This ensures any custom fields added to the junction table are preserved
        const throughSchemaM2A = JSON.parse(JSON.stringify(existingJunctionSchema.schema)); // Deep clone
        
        // Ensure item_id field has proper constraints disabled (only if it exists)
        if (throughSchemaM2A.fields.item_id) {
            throughSchemaM2A.fields.item_id = {
                ...throughSchemaM2A.fields.item_id,
                references: null,
                constraints: false,
                foreignKey: false,
            };
        }
        
        // Only remove BelongsTo relationships for tables that are no longer needed
        // Preserve any custom fields that are not table relationships
        for (const table of tablesToRemove) {
            if (throughSchemaM2A.fields[table] && 
                throughSchemaM2A.fields[table].relType === "BelongsTo" && 
                throughSchemaM2A.fields[table].foreignKey === "item_id") {
                console.log(`Removing M2A table relationship: ${table}`);
                delete throughSchemaM2A.fields[table];
            }
        }
        
        // Add relationships for new tables only
        for (const table of tablesToAdd) {
            console.log(`Adding M2A table relationship: ${table}`);
            throughSchemaM2A.fields[table] = {
                relType: "BelongsTo",
                description: "M2A Junction Target",
                target: table,
                foreignKey: "item_id",
                as: table,
                constraints: false,
                SystemGenerated: true,
            };
        }

        // Update the through table
        await schemaManager.updateModel(throughTable, throughSchemaM2A, accountability);

        // Update the main HasMany relation from source to junction table
        sourceSchema.fields[fieldName] = {
            relType: "HasMany",
            target: throughTable,
            foreignKey: `${sourceCollection}_id`,
            as: fieldName,
            description: updatedFieldData.description || originalFieldData.description,
            onDelete: updatedFieldData.onDelete || originalFieldData.onDelete,
            onUpdate: updatedFieldData.onUpdate || originalFieldData.onUpdate,
            polymorphic: true,
            tables: newTables,
        };

        // Add relationships for newly added tables
        for (const table of tablesToAdd) {
            // Add or update inverse relationship in target schema
            const targetSchemaDoc = await getSchemaDefinition(table, accountability);
            const targetSchema = targetSchemaDoc?.schema;

            targetSchema.fields[updatedFieldData.alias || originalFieldData.alias] = {
                relType: "HasMany",
                target: throughTable,
                foreignKey: "item_id",
                as: updatedFieldData.alias || originalFieldData.alias,
                description: updatedFieldData.description || originalFieldData.description,
                constraints: false,
                scope: {
                    collection: table.toLowerCase(),
                },
                onDelete: updatedFieldData.onDelete || originalFieldData.onDelete,
                onUpdate: updatedFieldData.onUpdate || originalFieldData.onUpdate,
            };

            await schemaManager.updateModel(table, targetSchema, accountability);
        }

        // Update existing tables in case the alias or other properties changed
        for (const table of newTables.filter(t => !tablesToAdd.includes(t))) {
            const targetSchemaDoc = await getSchemaDefinition(table, accountability);
            const targetSchema = targetSchemaDoc?.schema;

            if (targetSchema.fields[originalFieldData.alias]) {
                targetSchema.fields[updatedFieldData.alias || originalFieldData.alias] = {
                    relType: "HasMany",
                    target: throughTable,
                    foreignKey: "item_id",
                    as: updatedFieldData.alias || originalFieldData.alias,
                    description: updatedFieldData.description || originalFieldData.description,
                    constraints: false,
                    scope: {
                        collection: table.toLowerCase(),
                    },
                    onDelete: updatedFieldData.onDelete || originalFieldData.onDelete,
                    onUpdate: updatedFieldData.onUpdate || originalFieldData.onUpdate,
                };

                await schemaManager.updateModel(table, targetSchema, accountability);
            }
        }

        // Update the source schema
        await schemaManager.updateModel(sourceCollection, sourceSchema, accountability);
    }

    // Export schema as JSON file
    app.get("/schemas-export", adminOnly, async (req, res, next) => {
        try {
            const schemaService = new ItemsService('baasix_SchemaDefinition', { accountability: req.accountability as any });
            const schemasResult = await schemaService.readByQuery({
                sort: ['collectionName'],
                limit: -1
            }, true);
            const schemas = schemasResult.data;

            // Create a versioned export with metadata
            const schemaExport = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                schemas: schemas.map((schema) => ({
                    collectionName: schema.collectionName,
                    schema: schema.schema,
                    createdAt: schema.createdAt,
                    updatedAt: schema.updatedAt,
                })),
            };

            // Set headers for file download
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=schema-export-${Date.now()}.json`);

            // Send the JSON as a file download response to the client browser as buffer
            res.status(200).send(Buffer.from(JSON.stringify(schemaExport, null, 2)));
        } catch (error) {
            next(new APIError("Error exporting schemas", 500, error.message));
        }
    });

    // Preview schema changes from uploaded file
    app.post(
        "/schemas-preview-import",
        adminOnly,
        fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }), // 50MB limit
        async (req, res, next) => {
            try {
                if (!req.files || !req.files.schema) {
                    throw new APIError("No schema file uploaded", 400);
                }

                const schemaFile = req.files.schema as fileUpload.UploadedFile;

                // Validate file type
                if (!schemaFile.mimetype.includes("application/json")) {
                    throw new APIError("Invalid file type. Please upload a JSON file", 400);
                }

                // Parse the uploaded JSON file
                let importData;
                try {
                    importData = JSON.parse(schemaFile.data.toString());
                } catch (error) {
                    throw new APIError("Invalid JSON file", 400);
                }

                const schemaService = new ItemsService('baasix_SchemaDefinition', { accountability: req.accountability as any });
                const currentSchemasResult = await schemaService.readByQuery({ limit: -1 }, true);
                const currentSchemas = currentSchemasResult.data;
                const currentSchemaMap = new Map(currentSchemas.map((s) => [s.collectionName, s]));

                // Analyze changes
                const changes = {
                    new: [],
                    modified: [],
                    deleted: [],
                    unchanged: [],
                };

                // Check for new and modified schemas
                for (const importSchema of importData.schemas) {
                    const currentSchema = currentSchemaMap.get(importSchema.collectionName);

                    if (!currentSchema) {
                        changes.new.push({
                            collectionName: importSchema.collectionName,
                            details: "New schema will be created",
                        });
                        continue;
                    }

                    const differences = compareSchemas(currentSchema.schema, importSchema.schema);
                    if (Object.keys(differences).length > 0) {
                        changes.modified.push({
                            collectionName: importSchema.collectionName,
                            differences,
                        });
                    } else {
                        changes.unchanged.push(importSchema.collectionName);
                    }
                }

                // Check for deleted schemas
                for (const [collectionName, schema] of currentSchemaMap) {
                    if (!importData.schemas.find((s) => s.collectionName === collectionName)) {
                        changes.deleted.push(collectionName);
                    }
                }

                res.status(200).json({
                    importVersion: importData.version,
                    importTimestamp: importData.timestamp,
                    changes,
                });
            } catch (error) {
                next(new APIError("Error analyzing schema changes", 500, error.message));
            }
        }
    );

    // Import schema from uploaded file
    app.post(
        "/schemas-import",
        adminOnly,
        fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }), // 50MB limit
        async (req, res, next) => {
            try {
                if (!req.files || !req.files.schema) {
                    throw new APIError("No schema file uploaded", 400);
                }

                const schemaFile = req.files.schema as fileUpload.UploadedFile;

                // Validate file type
                if (!schemaFile.mimetype.includes("application/json")) {
                    throw new APIError("Invalid file type. Please upload a JSON file", 400);
                }

                // Parse the uploaded JSON file
                let importData;
                try {
                    importData = JSON.parse(schemaFile.data.toString());
                } catch (error) {
                    throw new APIError("Invalid JSON file", 400);
                }

                // Validate import data structure
                if (!importData.version || !importData.schemas) {
                    throw new APIError("Invalid import data format", 400);
                }

                // Track all changes made during import
                const changes = {
                    created: [],
                    updated: [],
                    unchanged: [],
                    deleted: [],
                    errors: [],
                };

                // Track collections with realtime config changes for efficient sync
                const realtimeChangedCollections: string[] = [];

                // Process each schema
                for (const schemaData of importData.schemas) {
                    try {
                        const existingSchema = await getSchemaDefinition(schemaData.collectionName, req.accountability);

                        // Process schema flags
                        const processedSchema = processSchemaFlags(schemaData.schema);

                        if (existingSchema) {
                            // Check if schema has actually changed
                            const differences = compareSchemas(existingSchema.schema, processedSchema);

                            if (Object.keys(differences).length > 0) {
                                // Track if realtime config changed
                                if (differences.realtime) {
                                    realtimeChangedCollections.push(schemaData.collectionName);
                                }

                                // Update existing schema only if there are changes
                                await schemaManager.updateModel(
                                    schemaData.collectionName,
                                    processedSchema,
                                    req.accountability
                                );
                                changes.updated.push(schemaData.collectionName);
                            } else {
                                // Schema is unchanged, skip syncing
                                console.log(`Schema ${schemaData.collectionName} is unchanged, skipping sync`);
                                changes.unchanged.push(schemaData.collectionName);
                            }
                        } else {
                            // Create new schema - check if it has realtime enabled
                            if (processedSchema.realtime === true || 
                                (typeof processedSchema.realtime === 'object' && processedSchema.realtime?.enabled)) {
                                realtimeChangedCollections.push(schemaData.collectionName);
                            }

                            // Create new schema
                            await schemaManager.updateModel(
                                schemaData.collectionName,
                                processedSchema,
                                req.accountability
                            );
                            changes.created.push(schemaData.collectionName);
                        }
                    } catch (error) {
                        console.error(`Error importing schema ${schemaData.collectionName}:`, error);
                        changes.errors.push({
                            collectionName: schemaData.collectionName,
                            error: error.message,
                        });

                        throw new APIError("Schema import failed", 400, changes);
                    }
                }

                await invalidateEntireCache();

                // Reload realtime configuration only for collections with realtime changes
                if (realtimeChangedCollections.length > 0) {
                    try {
                        const realtimeService = (await import('../services/RealtimeService.js')).default;
                        if (realtimeService.isWalAvailable()) {
                            await realtimeService.reloadCollections(realtimeChangedCollections);
                            console.log(`Realtime configuration reloaded for ${realtimeChangedCollections.length} collections: ${realtimeChangedCollections.join(', ')}`);
                        }
                    } catch (error) {
                        console.warn('Could not reload realtime configuration:', error.message);
                    }
                }

                res.status(200).json({
                    message: "Schema import completed",
                    changes,
                });
            } catch (error) {
                throw new APIError("Schema import failed", 400, error);
            }
        }
    );

    // Helper function for deep equality comparison (ignores property order)
    function deepEqual(obj1: any, obj2: any): boolean {
        if (obj1 === obj2) return true;
        if (obj1 === null || obj2 === null) return false;
        if (typeof obj1 !== typeof obj2) return false;
        
        if (typeof obj1 !== 'object') return obj1 === obj2;
        
        if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
        
        if (Array.isArray(obj1)) {
            if (obj1.length !== obj2.length) return false;
            for (let i = 0; i < obj1.length; i++) {
                if (!deepEqual(obj1[i], obj2[i])) return false;
            }
            return true;
        }
        
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        
        if (keys1.length !== keys2.length) return false;
        
        for (const key of keys1) {
            if (!keys2.includes(key)) return false;
            if (!deepEqual(obj1[key], obj2[key])) return false;
        }
        
        return true;
    }

    // Helper function to normalize schema for comparison
    // Removes SystemGenerated field as it's metadata that doesn't affect DB structure
    function normalizeSchemaForComparison(schema: any): any {
        if (!schema) return schema;
        
        const normalized = { ...schema };
        
        if (normalized.fields) {
            normalized.fields = { ...normalized.fields };
            for (const fieldName of Object.keys(normalized.fields)) {
                const field = normalized.fields[fieldName];
                if (field && typeof field === 'object') {
                    // Create a copy without SystemGenerated for comparison
                    const { SystemGenerated, ...fieldWithoutSystemGenerated } = field;
                    normalized.fields[fieldName] = fieldWithoutSystemGenerated;
                }
            }
        }
        
        return normalized;
    }

    // Helper function to compare schemas
    function compareSchemas(currentSchema, newSchema) {
        // Normalize both schemas before comparison
        const normalizedCurrent = normalizeSchemaForComparison(currentSchema);
        const normalizedNew = normalizeSchemaForComparison(newSchema);
        
        const differences: any = {};

        // Compare fields
        const allFields = new Set([...Object.keys(normalizedCurrent.fields || {}), ...Object.keys(normalizedNew.fields || {})]);

        for (const field of allFields) {
            if (!normalizedCurrent.fields[field]) {
                differences[field] = {
                    type: "added",
                    details: normalizedNew.fields[field],
                };
            } else if (!normalizedNew.fields[field]) {
                differences[field] = {
                    type: "removed",
                    details: normalizedCurrent.fields[field],
                };
            } else if (!deepEqual(normalizedCurrent.fields[field], normalizedNew.fields[field])) {
                differences[field] = {
                    type: "modified",
                    from: normalizedCurrent.fields[field],
                    to: normalizedNew.fields[field],
                };
            }
        }

        // Compare indexes
        if (normalizedCurrent.indexes || normalizedNew.indexes) {
            const currentIndexes = normalizedCurrent.indexes || [];
            const newIndexes = normalizedNew.indexes || [];

            if (!deepEqual(currentIndexes, newIndexes)) {
                differences.indexes = {
                    type: "modified",
                    from: currentIndexes,
                    to: newIndexes,
                };
            }
        }

        // Compare realtime configuration
        if (normalizedCurrent.realtime !== undefined || normalizedNew.realtime !== undefined) {
            if (!deepEqual(normalizedCurrent.realtime, normalizedNew.realtime)) {
                differences.realtime = {
                    type: "modified",
                    from: normalizedCurrent.realtime,
                    to: normalizedNew.realtime,
                };
            }
        }

        // Compare other properties
        const schemaProps = ["timestamps", "paranoid", "name"];
        for (const prop of schemaProps) {
            if (normalizedCurrent[prop] !== normalizedNew[prop]) {
                differences[prop] = {
                    type: "modified",
                    from: normalizedCurrent[prop],
                    to: normalizedNew[prop],
                };
            }
        }

        return differences;
    }

    // Add these endpoints to the permission.route.js file

    // Export roles and permissions
    app.get("/permissions-export", adminOnly, async (req, res, next) => {
        try {
            const roleService = new ItemsService('baasix_Role', { accountability: req.accountability as any });
            const permissionItemsService = new ItemsService('baasix_Permission', { accountability: req.accountability as any });

            // Get all roles sorted by name
            const rolesResult = await roleService.readByQuery({
                sort: ['name'],
                limit: -1
            }, true);
            const roles = rolesResult.data;

            // Get all permissions sorted by role_Id, collection, and action
            const permissionsResult = await permissionItemsService.readByQuery({
                sort: ['role_Id', 'collection', 'action'],
                limit: -1
            }, true);
            const permissions = permissionsResult.data;

            // Group permissions by role_Id
            const permissionsByRole = permissions.reduce((acc: any, permission: any) => {
                if (!acc[permission.role_Id]) {
                    acc[permission.role_Id] = [];
                }
                acc[permission.role_Id].push(permission);
                return acc;
            }, {});

            // Create a versioned export with metadata
            const exportData = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                roles: roles.map((role: any) => ({
                    name: role.name,
                    description: role.description,
                    permissions: (permissionsByRole[role.id] || []).map((permission: any) => ({
                        collection: permission.collection,
                        action: permission.action,
                        fields: permission.fields,
                        conditions: permission.conditions,
                        defaultValues: permission.defaultValues,
                        relConditions: permission.relConditions,
                    })),
                })),
            };

            // Set headers for file download
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=roles-permissions-export-${Date.now()}.json`);
            res.status(200).send(Buffer.from(JSON.stringify(exportData, null, 2)));
        } catch (error) {
            next(new APIError("Error exporting roles and permissions", 500, error.message));
        }
    });

    // Preview roles and permissions import
    app.post(
        "/permissions-preview-import",
        adminOnly,
        fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }),
        async (req, res, next) => {
            try {
                if (!req.files || !req.files.rolesPermissions) {
                    throw new APIError("No roles & permissions file uploaded", 400);
                }

                const uploadedFile = req.files.rolesPermissions as fileUpload.UploadedFile;
                if (!uploadedFile.mimetype.includes("application/json")) {
                    throw new APIError("Invalid file type. Please upload a JSON file", 400);
                }

                let importData;
                try {
                    importData = JSON.parse(uploadedFile.data.toString());
                } catch (error) {
                    throw new APIError("Invalid JSON file", 400);
                }

                const roleService = new ItemsService('baasix_Role', { accountability: req.accountability as any });
                const permissionItemsService = new ItemsService('baasix_Permission', { accountability: req.accountability as any });

                const currentRolesResult = await roleService.readByQuery({ limit: -1 }, true);
                const currentRoles = currentRolesResult.data;

                const permissionsResult = await permissionItemsService.readByQuery({ limit: -1 }, true);
                const permissions = permissionsResult.data;

                // Group permissions by role_Id
                const permissionsByRole = permissions.reduce((acc: any, permission: any) => {
                    if (!acc[permission.role_Id]) {
                        acc[permission.role_Id] = [];
                    }
                    acc[permission.role_Id].push(permission);
                    return acc;
                }, {});

                // Add permissions to roles
                const currentRolesWithPerms = currentRoles.map((role: any) => ({
                    ...role,
                    permissions: permissionsByRole[role.id] || []
                }));

                const currentRoleMap = new Map(currentRolesWithPerms.map((r: any) => [r.name, r]));

                const changes = {
                    new: [],
                    modified: [],
                    deleted: [],
                    unchanged: [],
                };

                // Analyze changes for roles and their permissions
                for (const importRole of importData.roles) {
                    const currentRole = currentRoleMap.get(importRole.name);

                    if (!currentRole) {
                        changes.new.push({
                            name: importRole.name,
                            type: "role",
                            details: `New role with ${importRole.permissions.length} permissions`,
                        });
                        continue;
                    }

                    const differences = compareRoleAndPermissions(currentRole, importRole);
                    if (Object.keys(differences).length > 0) {
                        changes.modified.push({
                            name: importRole.name,
                            type: "role",
                            differences,
                        });
                    } else {
                        changes.unchanged.push(importRole.name);
                    }
                }

                // Check for deleted roles
                for (const [roleName, role] of currentRoleMap) {
                    if (!importData.roles.find((r) => r.name === roleName)) {
                        changes.deleted.push({
                            name: roleName,
                            type: "role",
                        });
                    }
                }

                res.status(200).json({
                    importVersion: importData.version,
                    importTimestamp: importData.timestamp,
                    changes,
                });
            } catch (error) {
                console.error("Error analyzing roles and permissions changes:", error);
                next(new APIError("Error analyzing roles and permissions changes", 500, error.message));
            }
        }
    );

    // Import roles and permissions
    app.post(
        "/permissions-import",
        adminOnly,
        fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }),
        async (req, res, next) => {
            try {
                if (!req.files || !req.files.rolesPermissions) {
                    throw new APIError("No roles & permissions file uploaded", 400);
                }

                const uploadedFile = req.files.rolesPermissions;
                if (!Array.isArray(uploadedFile) && !uploadedFile.mimetype.includes("application/json")) {
                    throw new APIError("Invalid file type. Please upload a JSON file", 400);
                }

                let importData;
                try {
                    const fileData = Array.isArray(uploadedFile) ? uploadedFile[0].data : uploadedFile.data;
                    importData = JSON.parse(fileData.toString());
                } catch (error) {
                    throw new APIError("Invalid JSON file", 400);
                }

                if (!importData.version || !importData.roles) {
                    throw new APIError("Invalid import data format", 400);
                }

                const roleService = new ItemsService('baasix_Role', { accountability: req.accountability as any });
                const permissionItemsService = new ItemsService('baasix_Permission', { accountability: req.accountability as any });

                const changes = {
                    created: [],
                    updated: [],
                    deleted: [],
                    errors: [],
                };

                // Process each role and its permissions
                for (const roleData of importData.roles) {
                    try {
                        // Check if role exists
                        const existingRolesResult = await roleService.readByQuery({
                            filter: { name: roleData.name },
                            limit: 1
                        }, true);
                        const existingRole = existingRolesResult.data[0];

                        let roleId;
                        if (!existingRole) {
                            // Create new role - createOne returns only ID in Drizzle
                            roleId = await roleService.createOne({
                                name: roleData.name,
                                description: roleData.description
                            });
                            changes.created.push(`Role: ${roleData.name}`);
                        } else {
                            // Update existing role
                            await roleService.updateOne(existingRole.id, {
                                description: roleData.description
                            });
                            roleId = existingRole.id;
                            changes.updated.push(`Role: ${roleData.name}`);
                        }

                        // Delete existing permissions for this role
                        const existingPermsResult = await permissionItemsService.readByQuery({
                            filter: { role_Id: roleId },
                            limit: -1
                        }, true);
                        for (const perm of existingPermsResult.data) {
                            await permissionItemsService.deleteOne(perm.id);
                        }

                        // Create new permissions
                        const permissions = roleData.permissions.map((perm: any) => ({
                            ...perm,
                            role_Id: roleId,
                        }));

                        for (const perm of permissions) {
                            await permissionItemsService.createOne(perm);
                        }
                        changes.created.push(`Permissions for ${roleData.name}: ${permissions.length}`);
                    } catch (error: any) {
                        changes.errors.push({
                            role: roleData.name,
                            error: error.message,
                        });
                    }
                }

                await invalidateEntireCache();
                await permissionService.invalidateRoles(); // Reload roles cache
                await permissionService.loadPermissions(); // Reload permission cache (using imported singleton)

                res.status(200).json({
                    message: "Roles and permissions import completed",
                    changes,
                });
            } catch (error: any) {
                next(new APIError("Error importing roles and permissions", 500, error.message));
            }
        }
    );

    // Helper function to compare roles and their permissions
    function compareRoleAndPermissions(currentRole, importRole) {
        const differences: any = {};

        // Compare basic role properties
        if (currentRole.description !== importRole.description) {
            differences.description = {
                type: "modified",
                from: currentRole.description,
                to: importRole.description,
            };
        }

        // Compare permissions
        const currentPermissions = currentRole.permissions || [];
        const newPermissions = importRole.permissions || [];

        // Create maps for easier comparison
        const currentPermMap = new Map(
            currentPermissions.map((p) => [
                `${p.collection}:${p.action}`,
                {
                    fields: p.fields,
                    conditions: p.conditions,
                    defaultValues: p.defaultValues,
                    relConditions: p.relConditions,
                },
            ])
        );

        const newPermMap = new Map(
            newPermissions.map((p) => [
                `${p.collection}:${p.action}`,
                {
                    fields: p.fields,
                    conditions: p.conditions,
                    defaultValues: p.defaultValues,
                    relConditions: p.relConditions,
                },
            ])
        );

        // Check for added and modified permissions
        for (const [key, newPerm] of newPermMap) {
            if (!currentPermMap.has(key)) {
                if (!differences.permissions) differences.permissions = {};
                if (!differences.permissions.added) differences.permissions.added = [];
                differences.permissions.added.push(key);
            } else {
                const currentPerm = currentPermMap.get(key);
                if (JSON.stringify(currentPerm) !== JSON.stringify(newPerm)) {
                    if (!differences.permissions) differences.permissions = {};
                    if (!differences.permissions.modified) differences.permissions.modified = [];
                    differences.permissions.modified.push({
                        permission: key,
                        changes: compareObjects(currentPerm, newPerm),
                    });
                }
            }
        }

        // Check for removed permissions
        for (const [key] of currentPermMap) {
            if (!newPermMap.has(key)) {
                if (!differences.permissions) differences.permissions = {};
                if (!differences.permissions.removed) differences.permissions.removed = [];
                differences.permissions.removed.push(key);
            }
        }

        return differences;
    }

    // Helper function to compare objects
    function compareObjects(obj1, obj2) {
        const changes = {};
        const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

        for (const key of allKeys) {
            if (!Object.prototype.hasOwnProperty.call(obj1, key)) {
                changes[key] = { type: "added", value: obj2[key] };
            } else if (!Object.prototype.hasOwnProperty.call(obj2, key)) {
                changes[key] = { type: "removed", value: obj1[key] };
            } else if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
                changes[key] = {
                    type: "modified",
                    from: obj1[key],
                    to: obj2[key],
                };
            }
        }

        return changes;
    }
};

export default {
    id: "schemas",
    handler: registerEndpoint,
};
