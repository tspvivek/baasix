import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import path from "path";
import fs from "fs";

let app;
let adminToken;
let testCollectionName = "testcsvCollection";

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    // Create a test collection schema using the correct format
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: testCollectionName,
            schema: {
                name: testCollectionName,
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    name: { type: "String", allowNull: false },
                    email: { type: "String", allowNull: false },
                    age: { type: "Integer", allowNull: true },
                    metadata: { type: "JSON", allowNull: true },
                    tags: { type: "JSON", allowNull: true }
                }
            }
        });
});

afterAll(async () => {
    // Clean up: Delete test collection
    try {
      /*  await request(app)
            .delete(`/schemas/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`); */
    } catch (error) {
        console.error("Cleanup error:", error);
    }
});

describe("CSV Import Endpoint", () => {
    const createTempCSVFile = (content, filename = "test.csv") => {
        const tempDir = "/tmp";
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, content);
        return filePath;
    };

    const cleanupTempFile = (filePath) => {
        try {
            fs.unlinkSync(filePath);
        } catch (error) {
            // File might not exist, ignore
        }
    };

    test("should successfully import valid CSV file", async () => {
        const csvContent = `name,email,age,metadata,tags
John Doe,john@example.com,30,"{""department"": ""IT""}","[""admin"", ""user""]"
Jane Smith,jane@example.com,25,"{""department"": ""HR""}","[""user""]"
Bob Johnson,bob@example.com,35,"{""department"": ""Finance""}","[""manager"", ""user""]"`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(3);
            expect(response.body.results.failed).toBe(0);
            expect(response.body.message).toBe("Successfully imported 3 items");

            // Verify the data was actually imported
            const itemsResponse = await request(app)
                .get(`/items/${testCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(itemsResponse.body.data.length).toBe(3);
            
            // Check JSON parsing worked correctly
            const johnDoe = itemsResponse.body.data.find(item => item.name === "John Doe");
            expect(johnDoe).toBeDefined();
            expect(johnDoe.metadata).toEqual({ department: "IT" });
            expect(johnDoe.tags).toEqual(["admin", "user"]);

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should return error when no file is provided", async () => {
        const response = await request(app)
            .post(`/items/${testCollectionName}/import-csv`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe("No CSV file provided");
    });

    test("should return error when file is not CSV", async () => {
        const txtContent = "This is not a CSV file";
        const filePath = createTempCSVFile(txtContent, "test.txt");

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toBe("File must be a CSV file");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should return error when CSV file is empty", async () => {
        const csvContent = "";
        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toBe("CSV file is empty or has no valid data");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should return error when CSV has only headers", async () => {
        const csvContent = "name,email,age";
        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toBe("CSV file is empty or has no valid data");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle malformed JSON gracefully", async () => {
        // Clear existing data first
        await request(app)
            .delete(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({}) });

        const csvContent = `name,email,metadata
John Test,john.test@example.com,"{""department"": ""IT""}"
Jane Test,jane.test@example.com,"{invalid json"
Bob Test,bob.test@example.com,"valid string data"`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(3);

            // Verify the data
            const itemsResponse = await request(app)
                .get(`/items/${testCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            const johnDoe = itemsResponse.body.data.find(item => item.name === "John Test");
            const janeSmith = itemsResponse.body.data.find(item => item.name === "Jane Test");
            const bobJohnson = itemsResponse.body.data.find(item => item.name === "Bob Test");

            expect(johnDoe).toBeDefined();
            expect(janeSmith).toBeDefined();
            expect(bobJohnson).toBeDefined();
            expect(johnDoe.metadata).toEqual({ department: "IT" });
            expect(janeSmith.metadata).toBe("{invalid json"); // Should remain as string
            expect(bobJohnson.metadata).toBe("valid string data");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should rollback transaction when validation fails", async () => {
        // Clear existing data first
        await request(app)
            .delete(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({}) });

        // Create CSV with some valid and some invalid data (missing required field)
        const csvContent = `name,email,age
John Rollback,john.rollback@example.com,30
,jane.rollback@example.com,25
Bob Rollback,bob.rollback@example.com,35`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toContain("Import failed");
            expect(response.body.error.message).toContain("Transaction rolled back");
            expect(response.body.error.details.results.failed).toBeGreaterThan(0);
            expect(response.body.error.details.results.errors.length).toBeGreaterThan(0);

            // Verify no items were imported due to rollback
            const itemsResponse = await request(app)
                .get(`/items/${testCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            // Should have no items since transaction rolled back
            const rollbackItems = itemsResponse.body.data.filter(item => 
                item.name === "John Rollback" || item.name === "Bob Rollback"
            );
            
            // Since transaction rolled back, these specific items shouldn't exist from this test
            expect(rollbackItems.length).toBe(0);

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle invalid CSV format", async () => {
        const csvContent = `name,email,age
John Doe,john@example.com,30
Invalid CSV line with missing quotes and commas
Bob Johnson,bob@example.com,35`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            // Should fail due to CSV parsing issues
            expect(response.status).toBe(400);
            expect(response.body.error.message).toContain("Invalid CSV format");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should return 404 for non-existent collection", async () => {
        const csvContent = `name,email
John Doe,john@example.com`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post("/items/non_existent_collection/import-csv")
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(404);
            expect(response.body.error.message).toBe("Model non_existent_collection not found");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle JSON arrays correctly", async () => {
        // Clear existing data first
        await request(app)
            .delete(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({}) });

        const csvContent = `name,email,tags
John Array,john.array@example.com,"[""tag1"", ""tag2"", ""tag3""]"
Jane Array,jane.array@example.com,"[""singleTag""]"
Bob Array,bob.array@example.com,"[]"`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(3);

            // Verify JSON array parsing
            const itemsResponse = await request(app)
                .get(`/items/${testCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            const items = itemsResponse.body.data;
            const johnDoe = items.find(item => item.name === "John Array");
            const janeSmith = items.find(item => item.name === "Jane Array");
            const bobJohnson = items.find(item => item.name === "Bob Array");

            expect(johnDoe).toBeDefined();
            expect(janeSmith).toBeDefined();
            expect(bobJohnson).toBeDefined();
            expect(johnDoe.tags).toEqual(["tag1", "tag2", "tag3"]);
            expect(janeSmith.tags).toEqual(["singleTag"]);
            expect(bobJohnson.tags).toEqual([]);

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should require authentication", async () => {
        const csvContent = `name,email
John Doe,john@example.com`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-csv`)
                .attach("csvFile", filePath);

            // Without authentication, should get permission error during import
            expect(response.status).toBe(400);
            expect(response.body.error.message).toContain("Import failed");
            expect(response.body.error.details.results.errors[0].error).toContain("permission");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle nested relational data creation through JSON in CSV (Future Enhancement)", async () => {
        // NOTE: This test demonstrates the expected behavior for nested relational data creation
        // Currently, the CSV import only supports foreign key references, not nested creation
        // Future enhancement should allow categories to be created automatically from JSON data
        
        // First create a Categories collection
        const categoryCollectionName = "testCategories";
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: categoryCollectionName,
                schema: {
                    name: categoryCollectionName,
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        name: { type: "String", allowNull: false },
                        description: { type: "String", allowNull: true }
                    }
                }
            });

        // Create a Posts collection with categoryId field
        const postsCollectionName = "testPosts";
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: postsCollectionName,
                schema: {
                    name: postsCollectionName,
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        title: { type: "String", allowNull: false },
                        content: { type: "String", allowNull: true },
                        tags: { type: "JSON", allowNull: true },
                        metadata: { type: "JSON", allowNull: true }
                    }
                }
            });

        // Create M2O relationship: Posts belongs to Category
        await request(app)
            .post(`/schemas/${postsCollectionName}/relationships`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                type: "M2O",
                target: categoryCollectionName,
                name: "category",
                alias: "posts"
            });

        // CSV with nested relational data - category details will be created automatically
        // Using 'category' as the column name to match the relationship name
        const csvContent = `title,content,category,tags,metadata
"Advanced Node.js","Deep dive into Node.js internals","{""name"": ""Technology"", ""description"": ""Tech articles""}","[""nodejs"", ""backend"", ""javascript""]","{""author"": ""John Doe"", ""difficulty"": ""advanced""}"
"React Hooks Guide","Complete guide to React hooks","{""name"": ""Frontend"", ""description"": ""Frontend development""}","[""react"", ""hooks"", ""javascript""]","{""author"": ""Jane Smith"", ""difficulty"": ""intermediate""}"
"Database Design","Best practices for database design","{""name"": ""Database"", ""description"": ""Database topics""}","[""database"", ""design"", ""sql""]","{""author"": ""Bob Wilson"", ""difficulty"": ""beginner""}"`;

        const filePath = createTempCSVFile(csvContent);

        try {
            const response = await request(app)
                .post(`/items/${postsCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(3);
            expect(response.body.results.failed).toBe(0);

            // Verify posts were created
            const postsResponse = await request(app)
                .get(`/items/${postsCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(postsResponse.body.data.length).toBe(3);

            const posts = postsResponse.body.data;
            const nodePost = posts.find(post => post.title === "Advanced Node.js");
            const reactPost = posts.find(post => post.title === "React Hooks Guide");
            const dbPost = posts.find(post => post.title === "Database Design");

            // Verify posts exist
            expect(nodePost).toBeDefined();
            expect(reactPost).toBeDefined();
            expect(dbPost).toBeDefined();

            // Verify categories were created automatically and linked
            expect(nodePost.category_id).toBeDefined();
            expect(reactPost.category_id).toBeDefined();
            expect(dbPost.category_id).toBeDefined();

            // Get the created categories to verify they exist
            const categoriesResponse = await request(app)
                .get(`/items/${categoryCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(categoriesResponse.body.data.length).toBe(3);

            const categories = categoriesResponse.body.data;
            const techCategory = categories.find(cat => cat.name === "Technology");
            const frontendCategory = categories.find(cat => cat.name === "Frontend");
            const dbCategory = categories.find(cat => cat.name === "Database");

            // Verify categories were created with correct data
            expect(techCategory).toBeDefined();
            expect(techCategory.description).toBe("Tech articles");
            expect(frontendCategory).toBeDefined();
            expect(frontendCategory.description).toBe("Frontend development");
            expect(dbCategory).toBeDefined();
            expect(dbCategory.description).toBe("Database topics");

            // Verify the relationships are correctly established
            expect(nodePost.category_id).toBe(techCategory.id);
            expect(reactPost.category_id).toBe(frontendCategory.id);
            expect(dbPost.category_id).toBe(dbCategory.id);

            // Get posts with expanded relationships to verify nested data
            const postsExpandedResponse = await request(app)
                .get(`/items/${postsCollectionName}`)
                .query({ fields: JSON.stringify(["*", "category.*"]) })
                .set("Authorization", `Bearer ${adminToken}`);

            const expandedPosts = postsExpandedResponse.body.data;
            const expandedNodePost = expandedPosts.find(post => post.title === "Advanced Node.js");
            const expandedReactPost = expandedPosts.find(post => post.title === "React Hooks Guide");
            const expandedDbPost = expandedPosts.find(post => post.title === "Database Design");

            // Verify the nested category data is accessible
            if (expandedNodePost.category) {
                expect(expandedNodePost.category.name).toBe("Technology");
                expect(expandedNodePost.category.description).toBe("Tech articles");
            }
            
            if (expandedReactPost.category) {
                expect(expandedReactPost.category.name).toBe("Frontend");
                expect(expandedReactPost.category.description).toBe("Frontend development");
            }
            
            if (expandedDbPost.category) {
                expect(expandedDbPost.category.name).toBe("Database");
                expect(expandedDbPost.category.description).toBe("Database topics");
            }

            // Verify JSON parsing worked for other fields
            expect(nodePost.tags).toEqual(["nodejs", "backend", "javascript"]);
            expect(reactPost.tags).toEqual(["react", "hooks", "javascript"]);
            expect(dbPost.tags).toEqual(["database", "design", "sql"]);

            expect(nodePost.metadata).toEqual({
                author: "John Doe",
                difficulty: "advanced"
            });
            expect(reactPost.metadata).toEqual({
                author: "Jane Smith",
                difficulty: "intermediate"
            });
            expect(dbPost.metadata).toEqual({
                author: "Bob Wilson",
                difficulty: "beginner"
            });

        } finally {
            cleanupTempFile(filePath);
            
            // Clean up the test collections
            try {
               /* await request(app)
                    .delete(`/schemas/${postsCollectionName}`)
                    .set("Authorization", `Bearer ${adminToken}`);
                await request(app)
                    .delete(`/schemas/${categoryCollectionName}`)
                    .set("Authorization", `Bearer ${adminToken}`); */
            } catch (error) {
                console.error("Cleanup error:", error);
            }
        }
    });

    test("should handle relational data import with existing foreign key references", async () => {
        // Create a Categories collection
        const categoryCollectionName = "testCategories";
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: categoryCollectionName,
                schema: {
                    name: categoryCollectionName,
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        name: { type: "String", allowNull: false },
                        description: { type: "String", allowNull: true }
                    }
                }
            });

        // Create a Posts collection with categoryId field
        const postsCollectionName = "testPosts";
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: postsCollectionName,
                schema: {
                    name: postsCollectionName,
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        title: { type: "String", allowNull: false },
                        content: { type: "String", allowNull: true },
                        tags: { type: "JSON", allowNull: true },
                        metadata: { type: "JSON", allowNull: true }
                    }
                }
            });

        // Create M2O relationship: Posts belongs to Category
        await request(app)
            .post(`/schemas/${postsCollectionName}/relationships`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                type: "M2O",
                target: categoryCollectionName,
                name: "category",
                alias: "posts"
            });

        // Pre-create categories that we can reference
        const techCategoryResp = await request(app)
            .post(`/items/${categoryCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Technology", description: "Tech articles" });
        
        const frontendCategoryResp = await request(app)
            .post(`/items/${categoryCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Frontend", description: "Frontend development" });

        // CSV with foreign key references to existing categories
        const csvContent = `title,content,category_id,tags,metadata
"Advanced Node.js","Deep dive into Node.js internals",${techCategoryResp.body.data.id},"[""nodejs"", ""backend"", ""javascript""]","{""author"": ""John Doe"", ""difficulty"": ""advanced""}"
"React Hooks Guide","Complete guide to React hooks",${frontendCategoryResp.body.data.id},"[""react"", ""hooks"", ""javascript""]","{""author"": ""Jane Smith"", ""difficulty"": ""intermediate""}"`;

        const filePath = createTempCSVFile(csvContent);

        try {
            // Clear any existing posts from previous tests
            const existingPostsResponse = await request(app)
                .get(`/items/${postsCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            for (const post of existingPostsResponse.body.data) {
                await request(app)
                    .delete(`/items/${postsCollectionName}/${post.id}`)
                    .set("Authorization", `Bearer ${adminToken}`);
            }

            const response = await request(app)
                .post(`/items/${postsCollectionName}/import-csv`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("csvFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(2);
            expect(response.body.results.failed).toBe(0);

            // Verify posts were created with correct foreign key references
            const postsResponse = await request(app)
                .get(`/items/${postsCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(postsResponse.body.data.length).toBe(2);

            const posts = postsResponse.body.data;
            const nodePost = posts.find(post => post.title === "Advanced Node.js");
            const reactPost = posts.find(post => post.title === "React Hooks Guide");

            // Verify posts exist and have correct foreign key references
            expect(nodePost).toBeDefined();
            expect(reactPost).toBeDefined();
            expect(nodePost.category_id).toBe(techCategoryResp.body.data.id);
            expect(reactPost.category_id).toBe(frontendCategoryResp.body.data.id);

            // Verify JSON fields were parsed correctly
            expect(nodePost.tags).toEqual(["nodejs", "backend", "javascript"]);
            expect(reactPost.tags).toEqual(["react", "hooks", "javascript"]);
            expect(nodePost.metadata).toEqual({
                author: "John Doe",
                difficulty: "advanced"
            });
            expect(reactPost.metadata).toEqual({
                author: "Jane Smith",
                difficulty: "intermediate"
            });

        } finally {
            cleanupTempFile(filePath);
        }
    });
});