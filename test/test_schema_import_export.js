import request from 'supertest';
import { startServerForTesting, destroyAllTablesInDB } from '../baasix';
import fs from 'fs';

let app;
let adminToken;

async function runTests() {
    try {
        // Setup
        console.log("Starting server...");
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;
        console.log("Admin token received\n");

        // ===== STEP 1: Create initial schema =====
        console.log("=== STEP 1: Creating Initial Schema ===");

        // Create test_Products collection
        const productsSchema = {
            name: "Products",
            timestamps: true,
            paranoid: false,
            usertrack: false,
            sortField: "name",
            sortOrder: "asc",
            fields: {
                id: {
                    type: "UUID",
                    primaryKey: true,
                    defaultValue: "uuid_generate_v4()"
                },
                name: {
                    type: "String",
                    allowNull: false
                },
                price: {
                    type: "Decimal",
                    allowNull: true
                },
                description: {
                    type: "Text",
                    allowNull: true
                }
            }
        };

        const createProductsRes = await request(app)
            .post('/schemas')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                collectionName: 'test_Products',
                schema: productsSchema
            });

        console.log("Create test_Products status:", createProductsRes.statusCode);
        if (createProductsRes.statusCode !== 200) {
            console.log("Error:", createProductsRes.body);
        }

        // Create test_Categories collection
        const categoriesSchema = {
            name: "Categories",
            timestamps: true,
            paranoid: false,
            usertrack: false,
            fields: {
                id: {
                    type: "UUID",
                    primaryKey: true,
                    defaultValue: "uuid_generate_v4()"
                },
                name: {
                    type: "String",
                    allowNull: false
                }
            }
        };

        const createCategoriesRes = await request(app)
            .post('/schemas')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                collectionName: 'test_Categories',
                schema: categoriesSchema
            });

        console.log("Create test_Categories status:", createCategoriesRes.statusCode);

        // Create test_Orders collection (to be deleted later)
        const ordersSchema = {
            name: "Orders",
            timestamps: true,
            paranoid: false,
            usertrack: false,
            fields: {
                id: {
                    type: "UUID",
                    primaryKey: true,
                    defaultValue: "uuid_generate_v4()"
                },
                orderNumber: {
                    type: "String",
                    allowNull: false
                }
            }
        };

        const createOrdersRes = await request(app)
            .post('/schemas')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                collectionName: 'test_Orders',
                schema: ordersSchema
            });

        console.log("Create test_Orders status:", createOrdersRes.statusCode);
        console.log("✓ Initial schemas created\n");

        // ===== STEP 2: Export initial schema =====
        console.log("=== STEP 2: Exporting Initial Schema ===");

        const initialExportRes = await request(app)
            .get('/schemas-export')
            .set('Authorization', `Bearer ${adminToken}`);

        let initialExport;
        if (Buffer.isBuffer(initialExportRes.body)) {
            initialExport = JSON.parse(initialExportRes.body.toString());
        } else if (typeof initialExportRes.body === 'string') {
            initialExport = JSON.parse(initialExportRes.body);
        } else {
            initialExport = initialExportRes.body;
        }

        console.log("Export status:", initialExportRes.statusCode);
        console.log("Total schemas exported:", initialExport.schemas.length);

        const testSchemas = initialExport.schemas.filter(s => s.collectionName.startsWith('test_'));
        console.log("Test schemas:", testSchemas.map(s => s.collectionName).join(', '));
        console.log("✓ Initial export successful\n");

        // ===== STEP 3: Modify the export with all scenarios =====
        console.log("=== STEP 3: Modifying Export with All Scenarios ===");

        const modifiedExport = JSON.parse(JSON.stringify(initialExport));

        // Find our test schemas
        const productsIdx = modifiedExport.schemas.findIndex(s => s.collectionName === 'test_Products');
        const categoriesIdx = modifiedExport.schemas.findIndex(s => s.collectionName === 'test_Categories');
        const ordersIdx = modifiedExport.schemas.findIndex(s => s.collectionName === 'test_Orders');

        console.log("\nScenario 1: Adding new fields to test_Products");
        if (productsIdx !== -1) {
            modifiedExport.schemas[productsIdx].schema.fields.stock = {
                type: "Integer",
                allowNull: false,
                defaultValue: 0
            };
            modifiedExport.schemas[productsIdx].schema.fields.sku = {
                type: "String",
                allowNull: true,
                maxLength: 50
            };
            console.log("  ✓ Added 'stock' and 'sku' fields");
        }

        console.log("\nScenario 2: Deleting field from test_Products");
        if (productsIdx !== -1 && modifiedExport.schemas[productsIdx].schema.fields.description) {
            delete modifiedExport.schemas[productsIdx].schema.fields.description;
            console.log("  ✓ Deleted 'description' field");
        }

        console.log("\nScenario 3: Adding relational field to test_Products");
        if (productsIdx !== -1) {
            modifiedExport.schemas[productsIdx].schema.fields.category_Id = {
                type: "UUID",
                allowNull: true
            };
            modifiedExport.schemas[productsIdx].schema.fields.category = {
                type: "Relation",
                relType: "BelongsTo",
                target: "test_Categories",
                foreignKey: "category_Id"
            };
            console.log("  ✓ Added 'category' relation (BelongsTo test_Categories)");
        }

        console.log("\nScenario 4: Adding indexes to test_Products");
        if (productsIdx !== -1) {
            if (!modifiedExport.schemas[productsIdx].schema.indexes) {
                modifiedExport.schemas[productsIdx].schema.indexes = [];
            }
            modifiedExport.schemas[productsIdx].schema.indexes.push({
                name: "test_Products_name_idx",
                fields: ["name"],
                unique: false
            });
            modifiedExport.schemas[productsIdx].schema.indexes.push({
                name: "test_Products_sku_unique",
                fields: ["sku"],
                unique: true
            });
            console.log("  ✓ Added indexes: name_idx (non-unique), sku_unique (unique)");
        }

        console.log("\nScenario 5: Updating settings for test_Products");
        if (productsIdx !== -1) {
            modifiedExport.schemas[productsIdx].schema.paranoid = true;
            modifiedExport.schemas[productsIdx].schema.usertrack = true;
            modifiedExport.schemas[productsIdx].schema.sortField = "createdAt";
            modifiedExport.schemas[productsIdx].schema.sortOrder = "desc";
            console.log("  ✓ Changed: paranoid=true, usertrack=true, sort=createdAt:desc");
        }

        console.log("\nScenario 6: Adding HasMany relation to test_Categories");
        if (categoriesIdx !== -1) {
            modifiedExport.schemas[categoriesIdx].schema.fields.products = {
                type: "Relation",
                relType: "HasMany",
                target: "test_Products",
                foreignKey: "category_Id"
            };
            console.log("  ✓ Added 'products' relation (HasMany test_Products)");
        }

        console.log("\nScenario 7: Deleting test_Orders collection");
        if (ordersIdx !== -1) {
            modifiedExport.schemas.splice(ordersIdx, 1);
            console.log("  ✓ Removed test_Orders from export");
        }

        console.log("\nScenario 8: Adding new collection test_Suppliers");
        const suppliersSchema = {
            collectionName: "test_Suppliers",
            schema: {
                name: "Suppliers",
                timestamps: true,
                paranoid: false,
                usertrack: true,
                sortField: "name",
                sortOrder: "asc",
                fields: {
                    id: {
                        type: "UUID",
                        primaryKey: true,
                        defaultValue: "uuid_generate_v4()"
                    },
                    name: {
                        type: "String",
                        allowNull: false
                    },
                    email: {
                        type: "String",
                        allowNull: true
                    },
                    phone: {
                        type: "String",
                        allowNull: true
                    }
                },
                indexes: [
                    {
                        name: "test_Suppliers_email_unique",
                        fields: ["email"],
                        unique: true
                    }
                ]
            }
        };
        modifiedExport.schemas.push(suppliersSchema);
        console.log("  ✓ Added new collection test_Suppliers with index");

        // Save modified export
        const modifiedFile = '/tmp/test_schema_modified.json';
        fs.writeFileSync(modifiedFile, JSON.stringify(modifiedExport, null, 2));
        console.log("\n✓ All modifications completed\n");

        // ===== STEP 4: Preview import =====
        console.log("=== STEP 4: Previewing Import Changes ===");

        const previewRes = await request(app)
            .post('/schemas-preview-import')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('schema', modifiedFile);

        console.log("Preview status:", previewRes.statusCode);
        if (previewRes.statusCode === 200) {
            const preview = previewRes.body;
            console.log("\nPreview Results:");
            console.log("  Created:", preview.changes.created?.length || 0, "collection(s)");
            if (preview.changes.created?.length > 0) {
                preview.changes.created.forEach(c => console.log(`    - ${c}`));
            }
            console.log("  Updated:", preview.changes.updated?.length || 0, "collection(s)");
            if (preview.changes.updated?.length > 0) {
                preview.changes.updated.forEach(c => console.log(`    - ${c}`));
            }
            console.log("  Deleted:", preview.changes.deleted?.length || 0, "collection(s)");
            if (preview.changes.deleted?.length > 0) {
                preview.changes.deleted.forEach(c => console.log(`    - ${c}`));
            }
            console.log("  Unchanged:", preview.changes.unchanged?.length || 0, "collection(s)");
        } else {
            console.log("Preview error:", previewRes.body);
        }
        console.log();

        // ===== STEP 5: Import modified schema =====
        console.log("=== STEP 5: Importing Modified Schema ===");

        const importRes = await request(app)
            .post('/schemas-import')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('schema', modifiedFile);

        console.log("Import status:", importRes.statusCode);
        if (importRes.statusCode === 200) {
            const importResult = importRes.body;
            console.log("\nImport Results:");
            console.log("  Created:", importResult.changes.created?.length || 0);
            if (importResult.changes.created?.length > 0) {
                importResult.changes.created.forEach(c => console.log(`    - ${c}`));
            }
            console.log("  Updated:", importResult.changes.updated?.length || 0);
            if (importResult.changes.updated?.length > 0) {
                importResult.changes.updated.forEach(c => console.log(`    - ${c}`));
            }
            console.log("  Unchanged:", importResult.changes.unchanged?.length || 0);
            console.log("  Errors:", importResult.changes.errors?.length || 0);
            if (importResult.changes.errors?.length > 0) {
                importResult.changes.errors.forEach(e => console.log(`    - ${e.collectionName}: ${e.error}`));
            }
            console.log("\n✓ Import completed");
        } else {
            console.log("Import error:", JSON.stringify(importRes.body, null, 2));
        }
        console.log();

        // ===== STEP 6: Verify changes =====
        console.log("=== STEP 6: Verifying Changes ===");

        // Check if test_Products has new fields
        console.log("\nVerifying test_Products changes:");
        const getProductsSchemaRes = await request(app)
            .get('/schemas/test_Products')
            .set('Authorization', `Bearer ${adminToken}`);

        if (getProductsSchemaRes.statusCode === 200) {
            const productsData = getProductsSchemaRes.body;
            console.log("  Response structure:", Object.keys(productsData));

            // Handle different response formats
            const productsSchema = productsData.schema || productsData.data?.schema || productsData;

            if (!productsSchema || !productsSchema.fields) {
                console.log("  ✗ Invalid schema structure:", JSON.stringify(productsData, null, 2));
                return;
            }

            // Check new fields
            const hasStock = productsSchema.fields.hasOwnProperty('stock');
            const hasSku = productsSchema.fields.hasOwnProperty('sku');
            const hasDescription = productsSchema.fields.hasOwnProperty('description');
            const hasCategory = productsSchema.fields.hasOwnProperty('category');
            const hasCategoryId = productsSchema.fields.hasOwnProperty('category_Id');

            console.log("  New field 'stock':", hasStock ? "✓ EXISTS" : "✗ MISSING");
            console.log("  New field 'sku':", hasSku ? "✓ EXISTS" : "✗ MISSING");
            console.log("  Deleted field 'description':", hasDescription ? "✗ STILL EXISTS" : "✓ DELETED");
            console.log("  Relation 'category':", hasCategory ? "✓ EXISTS" : "✗ MISSING");
            console.log("  Foreign key 'category_Id':", hasCategoryId ? "✓ EXISTS" : "✗ MISSING");

            // Check settings
            console.log("  Setting 'paranoid':", productsSchema.paranoid === true ? "✓ TRUE" : "✗ FALSE");
            console.log("  Setting 'usertrack':", productsSchema.usertrack === true ? "✓ TRUE" : "✗ FALSE");
            console.log("  Setting 'sortField':", productsSchema.sortField === "createdAt" ? "✓ createdAt" : `✗ ${productsSchema.sortField}`);
            console.log("  Setting 'sortOrder':", productsSchema.sortOrder === "desc" ? "✓ desc" : `✗ ${productsSchema.sortOrder}`);

            // Check indexes
            const hasNameIndex = productsSchema.indexes?.some(idx => idx.name === 'test_Products_name_idx');
            const hasSkuIndex = productsSchema.indexes?.some(idx => idx.name === 'test_Products_sku_unique');
            console.log("  Index 'name_idx':", hasNameIndex ? "✓ EXISTS" : "✗ MISSING");
            console.log("  Index 'sku_unique':", hasSkuIndex ? "✓ EXISTS" : "✗ MISSING");
        } else {
            console.log("  ✗ Could not retrieve schema:", getProductsSchemaRes.statusCode);
        }

        // Check if test_Categories has products relation
        console.log("\nVerifying test_Categories changes:");
        const getCategoriesSchemaRes = await request(app)
            .get('/schemas/test_Categories')
            .set('Authorization', `Bearer ${adminToken}`);

        if (getCategoriesSchemaRes.statusCode === 200) {
            const categoriesData = getCategoriesSchemaRes.body;
            const categoriesSchema = categoriesData.schema || categoriesData.data?.schema || categoriesData;

            if (categoriesSchema && categoriesSchema.fields) {
                const hasProducts = categoriesSchema.fields.hasOwnProperty('products');
                console.log("  Relation 'products':", hasProducts ? "✓ EXISTS" : "✗ MISSING");
            } else {
                console.log("  ✗ Could not read schema structure");
            }
        }

        // Check if test_Suppliers was created
        console.log("\nVerifying test_Suppliers creation:");
        const getSuppliersSchemaRes = await request(app)
            .get('/schemas/test_Suppliers')
            .set('Authorization', `Bearer ${adminToken}`);

        if (getSuppliersSchemaRes.statusCode === 200) {
            const suppliersData = getSuppliersSchemaRes.body;
            const suppliersSchema = suppliersData.schema || suppliersData.data?.schema || suppliersData;

            if (suppliersSchema) {
                console.log("  Collection exists: ✓ YES");
                console.log("  Has usertrack:", suppliersSchema.usertrack === true ? "✓ TRUE" : "✗ FALSE");
                const hasEmailIndex = suppliersSchema.indexes?.some(idx => idx.name === 'test_Suppliers_email_unique');
                console.log("  Index 'email_unique':", hasEmailIndex ? "✓ EXISTS" : "✗ MISSING");
            } else {
                console.log("  ✗ Could not read schema structure");
            }
        } else {
            console.log("  Collection exists: ✗ NO (status:", getSuppliersSchemaRes.statusCode, ")");
        }

        // Check if test_Orders was deleted
        console.log("\nVerifying test_Orders deletion:");
        const getOrdersSchemaRes = await request(app)
            .get('/schemas/test_Orders')
            .set('Authorization', `Bearer ${adminToken}`);

        if (getOrdersSchemaRes.statusCode === 404) {
            console.log("  Collection deleted: ✓ YES");
        } else {
            console.log("  Collection deleted: ✗ NO (still exists with status:", getOrdersSchemaRes.statusCode, ")");
        }

        // ===== STEP 7: Test data operations =====
        console.log("\n=== STEP 7: Testing Data Operations ===");

        // Test creating data with new fields
        console.log("\nTesting data creation with new fields:");
        const createProductRes = await request(app)
            .post('/items/test_Products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: "Test Product",
                price: 99.99,
                stock: 100,
                sku: "TEST-SKU-001"
            });

        console.log("  Create product status:", createProductRes.statusCode);
        if (createProductRes.statusCode === 200) {
            console.log("  ✓ Product created with new fields");

            // Read back the product
            const productId = createProductRes.body.data.id;
            const readProductRes = await request(app)
                .get(`/items/test_Products/${productId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            if (readProductRes.statusCode === 200) {
                const product = readProductRes.body.data;
                console.log("  Product stock:", product.stock);
                console.log("  Product sku:", product.sku);
                console.log("  Has userCreated_Id:", product.userCreated_Id ? "✓ YES" : "✗ NO");
                console.log("  Has deletedAt:", product.hasOwnProperty('deletedAt') ? "✓ YES" : "✗ NO");
            }
        } else {
            console.log("  ✗ Failed to create product:", createProductRes.body);
        }

        console.log("\n=== All Tests Complete ===");
        process.exit(0);
    } catch (error) {
        console.error("Test error:", error);
        process.exit(1);
    }
}

runTests();
