import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import path from "path";
import fs from "fs";

let app;
let adminToken;
let testCollectionName = "testJsonCollection";

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

describe("JSON Import Endpoint", () => {
    const createTempJSONFile = (content, filename = "test.json") => {
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

    test("should successfully import valid JSON file", async () => {
        const jsonContent = JSON.stringify([
            {
                name: "John Doe",
                email: "john@example.com",
                age: 30,
                metadata: { department: "IT" },
                tags: ["admin", "user"]
            },
            {
                name: "Jane Smith",
                email: "jane@example.com",
                age: 25,
                metadata: { department: "HR" },
                tags: ["user"]
            },
            {
                name: "Bob Johnson",
                email: "bob@example.com",
                age: 35,
                metadata: { department: "Finance" },
                tags: ["manager", "user"]
            }
        ]);

        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

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
            .post(`/items/${testCollectionName}/import-json`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe("No JSON file provided");
    });

    test("should return error when file is not JSON", async () => {
        const txtContent = "This is not a JSON file";
        const filePath = createTempJSONFile(txtContent, "test.txt");

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toBe("File must be a JSON file");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should return error when JSON file is empty", async () => {
        const jsonContent = "[]";
        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toBe("JSON file is empty or has no valid data");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should return error when JSON is not an array", async () => {
        const jsonContent = JSON.stringify({
            name: "Single Object",
            email: "single@example.com"
        });
        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toBe("JSON file must contain an array of objects");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle invalid JSON gracefully", async () => {
        const invalidJsonContent = `[
            {"name": "John", "email": "john@example.com"},
            {"name": "Jane", "email": invalid json}
        ]`;

        const filePath = createTempJSONFile(invalidJsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(400);
            expect(response.body.error.message).toContain("Invalid JSON format");

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

        // Create JSON with some valid and some invalid data (missing required field)
        const jsonContent = JSON.stringify([
            {
                name: "John Rollback",
                email: "john.rollback@example.com",
                age: 30
            },
            {
                name: "",  // Invalid: empty name
                email: "jane.rollback@example.com",
                age: 25
            },
            {
                name: "Bob Rollback",
                email: "bob.rollback@example.com",
                age: 35
            }
        ]);

        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

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

    test("should return 404 for non-existent collection", async () => {
        const jsonContent = JSON.stringify([
            { name: "John Doe", email: "john@example.com" }
        ]);

        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post("/items/non_existent_collection/import-json")
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(404);
            expect(response.body.error.message).toBe("Model non_existent_collection not found");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle complex nested JSON objects correctly", async () => {
        // Clear existing data first
        await request(app)
            .delete(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ filter: JSON.stringify({}) });

        const jsonContent = JSON.stringify([
            {
                name: "John Complex",
                email: "john.complex@example.com",
                age: 30,
                metadata: {
                    department: "IT",
                    skills: ["JavaScript", "Node.js", "React"],
                    experience: {
                        years: 5,
                        level: "Senior"
                    }
                },
                tags: ["developer", "full-stack", "tech-lead"]
            },
            {
                name: "Jane Complex",
                email: "jane.complex@example.com",
                age: 28,
                metadata: {
                    department: "Design",
                    skills: ["Figma", "Photoshop", "UI/UX"],
                    experience: {
                        years: 4,
                        level: "Mid"
                    }
                },
                tags: ["designer", "creative"]
            }
        ]);

        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(2);

            // Verify complex JSON parsing
            const itemsResponse = await request(app)
                .get(`/items/${testCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            const items = itemsResponse.body.data;
            const johnDoe = items.find(item => item.name === "John Complex");
            const janeSmith = items.find(item => item.name === "Jane Complex");

            expect(johnDoe).toBeDefined();
            expect(janeSmith).toBeDefined();
            
            expect(johnDoe.metadata.department).toBe("IT");
            expect(johnDoe.metadata.skills).toEqual(["JavaScript", "Node.js", "React"]);
            expect(johnDoe.metadata.experience.years).toBe(5);
            expect(johnDoe.metadata.experience.level).toBe("Senior");
            expect(johnDoe.tags).toEqual(["developer", "full-stack", "tech-lead"]);

            expect(janeSmith.metadata.department).toBe("Design");
            expect(janeSmith.metadata.skills).toEqual(["Figma", "Photoshop", "UI/UX"]);
            expect(janeSmith.metadata.experience.years).toBe(4);
            expect(janeSmith.metadata.experience.level).toBe("Mid");
            expect(janeSmith.tags).toEqual(["designer", "creative"]);

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should require authentication", async () => {
        const jsonContent = JSON.stringify([
            { name: "John Doe", email: "john@example.com" }
        ]);

        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .attach("jsonFile", filePath);

            // Without authentication, should get 401
            expect(response.status).toBe(401);
            expect(response.body.error.message).toContain("Authentication required");

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle string values that need type conversion", async () => {
        // Clear existing data first by getting all items and deleting them
        const existingItemsResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        // Delete each existing item individually
        for (const item of existingItemsResponse.body.data) {
            await request(app)
                .delete(`/items/${testCollectionName}/${item.id}`)
                .set("Authorization", `Bearer ${adminToken}`);
        }

        const jsonContent = JSON.stringify([
            {
                name: "John String",
                email: "john.string@example.com",
                age: "30",  // String that should be converted to integer
                metadata: "{\"department\": \"IT\"}",  // String that should be parsed as JSON
                tags: "[\"tag1\", \"tag2\"]"  // String that should be parsed as JSON array
            }
        ]);

        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${testCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(1);

            // Verify type conversion worked
            const itemsResponse = await request(app)
                .get(`/items/${testCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            const item = itemsResponse.body.data.find(i => i.name === "John String");
            expect(item).toBeDefined();
            expect(item.age).toBe(30);  // Should be converted to number
            // JSON strings are parsed when inserted into JSON fields
            expect(item.metadata).toEqual({department: "IT"});  // JSON strings are parsed into objects
            expect(item.tags).toEqual(["tag1", "tag2"]);  // JSON array strings are parsed into arrays

        } finally {
            cleanupTempFile(filePath);
        }
    });

    test("should handle nested relational data creation through JSON", async () => {
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

        // JSON with nested relational data - category details will be created automatically
        const jsonContent = JSON.stringify([
            {
                title: "Advanced Node.js",
                content: "Deep dive into Node.js internals",
                category: { name: "Technology2", description: "Tech articles" },
                tags: ["nodejs", "backend", "javascript"],
                metadata: { author: "John Doe", difficulty: "advanced" }
            },
            {
                title: "React Hooks Guide",
                content: "Complete guide to React hooks",
                category: { name: "Frontend2", description: "Frontend development" },
                tags: ["react", "hooks", "javascript"],
                metadata: { author: "Jane Smith", difficulty: "intermediate" }
            },
            {
                title: "Database Design",
                content: "Best practices for database design",
                category: { name: "Database2", description: "Database topics" },
                tags: ["database", "design", "sql"],
                metadata: { author: "Bob Wilson", difficulty: "beginner" }
            }
        ]);

        const filePath = createTempJSONFile(jsonContent);

        try {
            const response = await request(app)
                .post(`/items/${postsCollectionName}/import-json`)
                .set("Authorization", `Bearer ${adminToken}`)
                .attach("jsonFile", filePath);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.results.imported).toBe(3);
            expect(response.body.results.failed).toBe(0);

            // Verify posts were created
            const postsResponse = await request(app)
                .get(`/items/${postsCollectionName}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(postsResponse.body.data.length).toBe(3);

            console.info(postsResponse.body.data);

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

            console.info(categoriesResponse.body.data);

            const categories = categoriesResponse.body.data;
            const techCategory = categories.find(cat => cat.name === "Technology2");
            const frontendCategory = categories.find(cat => cat.name === "Frontend2");
            const dbCategory = categories.find(cat => cat.name === "Database2");

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

            // Verify JSON fields were parsed correctly
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
        }
    });
});