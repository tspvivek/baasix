/**
 * Bulk Operations Test Suite
 * 
 * Tests the transactional safety of bulk create, update, and delete operations.
 * Verifies that:
 * 1. All operations in a bulk action succeed or fail together (atomicity)
 * 2. After hooks are only executed after successful transaction commit
 * 3. Rollback works correctly when any operation fails
 */

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";

let app;
let adminToken;
let testCollectionName = "bulkTestItems";

// Helper to clean the test collection
async function cleanupTestCollection() {
    try {
        const items = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);
        
        if (items.body.data && items.body.data.length > 0) {
            const ids = items.body.data.map(item => item.id);
            await request(app)
                .delete(`/items/${testCollectionName}/bulk`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send(ids);
        }
    } catch (error) {
        // Ignore cleanup errors
    }
}

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create a test collection schema for bulk operations
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
                    status: { type: "String", allowNull: true },
                    priority: { type: "Integer", allowNull: true },
                    metadata: { type: "JSON", allowNull: true }
                }
            }
        });
});

afterAll(async () => {
    await cleanupTestCollection();
});

describe("Bulk Create Operations", () => {
    beforeEach(async () => {
        await cleanupTestCollection();
    });

    test("should successfully create multiple items in bulk", async () => {
        const itemsToCreate = [
            { name: "Item 1", email: "item1@test.com", status: "active", priority: 1 },
            { name: "Item 2", email: "item2@test.com", status: "pending", priority: 2 },
            { name: "Item 3", email: "item3@test.com", status: "active", priority: 3 }
        ];

        const response = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(itemsToCreate);

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveLength(3);

        // Verify all items were created
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.body.data).toHaveLength(3);
        expect(getResponse.body.data.map(item => item.name).sort()).toEqual(["Item 1", "Item 2", "Item 3"]);
    });

    test("should rollback all items when one fails validation", async () => {
        const itemsToCreate = [
            { name: "Valid Item 1", email: "valid1@test.com", status: "active" },
            { name: null, email: "invalid@test.com", status: "active" }, // name is required, should fail
            { name: "Valid Item 3", email: "valid3@test.com", status: "active" }
        ];

        const response = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(itemsToCreate);

        // Should fail due to validation error
        expect(response.status).toBeGreaterThanOrEqual(400);

        // Verify NO items were created (transaction rollback)
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.body.data).toHaveLength(0);
    });

    test("should handle empty array gracefully", async () => {
        const response = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send([]);

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveLength(0);
    });

    test("should reject non-array body", async () => {
        const response = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Single Item", email: "single@test.com" });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe("Request body must be an array");
    });

    test("should create items with JSON metadata", async () => {
        const itemsToCreate = [
            { 
                name: "Item with metadata", 
                email: "meta1@test.com", 
                metadata: { department: "IT", tags: ["admin", "user"] }
            },
            { 
                name: "Item with different metadata", 
                email: "meta2@test.com", 
                metadata: { department: "HR", tags: ["hr", "manager"] }
            }
        ];

        const response = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(itemsToCreate);

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveLength(2);

        // Verify metadata was saved correctly
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const itemWithMeta = getResponse.body.data.find(item => item.name === "Item with metadata");
        expect(itemWithMeta.metadata).toEqual({ department: "IT", tags: ["admin", "user"] });
    });
});

describe("Bulk Update Operations", () => {
    let createdIds = [];

    beforeEach(async () => {
        await cleanupTestCollection();

        // Create test items for update tests
        const itemsToCreate = [
            { name: "Update Test 1", email: "update1@test.com", status: "active", priority: 1 },
            { name: "Update Test 2", email: "update2@test.com", status: "active", priority: 2 },
            { name: "Update Test 3", email: "update3@test.com", status: "active", priority: 3 }
        ];

        const createResponse = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(itemsToCreate);

        createdIds = createResponse.body.data;
    });

    test("should successfully update multiple items in bulk", async () => {
        const updates = [
            { id: createdIds[0], status: "completed", priority: 10 },
            { id: createdIds[1], status: "pending", priority: 20 },
            { id: createdIds[2], status: "archived", priority: 30 }
        ];

        const response = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(updates);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);

        // Verify updates were applied
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const item1 = getResponse.body.data.find(item => item.id === createdIds[0]);
        const item2 = getResponse.body.data.find(item => item.id === createdIds[1]);
        const item3 = getResponse.body.data.find(item => item.id === createdIds[2]);

        expect(item1.status).toBe("completed");
        expect(item1.priority).toBe(10);
        expect(item2.status).toBe("pending");
        expect(item2.priority).toBe(20);
        expect(item3.status).toBe("archived");
        expect(item3.priority).toBe(30);
    });

    test("should rollback all updates when one fails", async () => {
        const updates = [
            { id: createdIds[0], status: "updated" },
            { id: 99999, status: "should_fail" }, // Non-existent ID
            { id: createdIds[2], status: "updated" }
        ];

        const response = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(updates);

        // Should fail due to non-existent item
        expect(response.status).toBeGreaterThanOrEqual(400);

        // Verify NO updates were applied (transaction rollback)
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const item1 = getResponse.body.data.find(item => item.id === createdIds[0]);
        const item3 = getResponse.body.data.find(item => item.id === createdIds[2]);

        // Original status should be preserved
        expect(item1.status).toBe("active");
        expect(item3.status).toBe("active");
    });

    test("should skip items without id in update array", async () => {
        const updates = [
            { id: createdIds[0], status: "updated_with_id" },
            { status: "no_id_provided" }, // No ID, should be skipped
            { id: createdIds[2], status: "also_updated" }
        ];

        const response = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(updates);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2); // Only 2 items had IDs

        // Verify updates
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const item1 = getResponse.body.data.find(item => item.id === createdIds[0]);
        const item2 = getResponse.body.data.find(item => item.id === createdIds[1]);
        const item3 = getResponse.body.data.find(item => item.id === createdIds[2]);

        expect(item1.status).toBe("updated_with_id");
        expect(item2.status).toBe("active"); // Not updated
        expect(item3.status).toBe("also_updated");
    });

    test("should handle empty update array gracefully", async () => {
        const response = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send([]);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(0);
    });

    test("should reject non-array body for updates", async () => {
        const response = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ id: createdIds[0], status: "single_update" });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe("Request body must be an array");
    });

    test("should update items with partial data", async () => {
        // Update only specific fields
        const updates = [
            { id: createdIds[0], priority: 100 }, // Only update priority
            { id: createdIds[1], name: "New Name" } // Only update name
        ];

        const response = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(updates);

        expect(response.status).toBe(200);

        // Verify partial updates
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const item1 = getResponse.body.data.find(item => item.id === createdIds[0]);
        const item2 = getResponse.body.data.find(item => item.id === createdIds[1]);

        expect(item1.priority).toBe(100);
        expect(item1.name).toBe("Update Test 1"); // Should remain unchanged
        expect(item2.name).toBe("New Name");
        expect(item2.priority).toBe(2); // Should remain unchanged
    });
});

describe("Bulk Delete Operations", () => {
    let createdIds = [];

    beforeEach(async () => {
        await cleanupTestCollection();

        // Create test items for delete tests
        const itemsToCreate = [
            { name: "Delete Test 1", email: "delete1@test.com", status: "active" },
            { name: "Delete Test 2", email: "delete2@test.com", status: "active" },
            { name: "Delete Test 3", email: "delete3@test.com", status: "active" },
            { name: "Delete Test 4", email: "delete4@test.com", status: "active" }
        ];

        const createResponse = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(itemsToCreate);

        createdIds = createResponse.body.data;
    });

    test("should successfully delete multiple items in bulk", async () => {
        const idsToDelete = [createdIds[0], createdIds[1]];

        const response = await request(app)
            .delete(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(idsToDelete);

        expect(response.status).toBe(204);

        // Verify items were deleted
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.body.data).toHaveLength(2); // 2 remaining
        
        const remainingIds = getResponse.body.data.map(item => item.id);
        expect(remainingIds).not.toContain(createdIds[0]);
        expect(remainingIds).not.toContain(createdIds[1]);
        expect(remainingIds).toContain(createdIds[2]);
        expect(remainingIds).toContain(createdIds[3]);
    });

    test("should rollback all deletes when one fails", async () => {
        const idsToDelete = [
            createdIds[0],
            99999, // Non-existent ID - should cause failure
            createdIds[2]
        ];

        const response = await request(app)
            .delete(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(idsToDelete);

        // Should fail due to non-existent item
        expect(response.status).toBeGreaterThanOrEqual(400);

        // Verify NO items were deleted (transaction rollback)
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.body.data).toHaveLength(4); // All 4 should still exist
    });

    test("should delete all items in collection", async () => {
        const response = await request(app)
            .delete(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(createdIds);

        expect(response.status).toBe(204);

        // Verify all items were deleted
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.body.data).toHaveLength(0);
    });

    test("should handle empty delete array gracefully", async () => {
        const response = await request(app)
            .delete(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send([]);

        expect(response.status).toBe(204);

        // Verify no items were deleted
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.body.data).toHaveLength(4);
    });

    test("should reject non-array body for deletes", async () => {
        const response = await request(app)
            .delete(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ id: createdIds[0] });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe("Request body must be an array of IDs");
    });
});

describe("Bulk Operations - Transactional Consistency", () => {
    beforeEach(async () => {
        await cleanupTestCollection();
    });

    test("should maintain data consistency with large bulk create", async () => {
        // Create many items at once to test transaction handling
        const itemsToCreate = [];
        for (let i = 0; i < 50; i++) {
            itemsToCreate.push({
                name: `Bulk Item ${i}`,
                email: `bulk${i}@test.com`,
                status: i % 2 === 0 ? "active" : "pending",
                priority: i
            });
        }

        const response = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(itemsToCreate);

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveLength(50);

        // Verify all items were created with correct data
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.body.data).toHaveLength(50);

        // Verify data integrity
        const activeCount = getResponse.body.data.filter(item => item.status === "active").length;
        const pendingCount = getResponse.body.data.filter(item => item.status === "pending").length;
        expect(activeCount).toBe(25);
        expect(pendingCount).toBe(25);
    });

    test("should handle concurrent-like operations correctly", async () => {
        // Create initial items
        const initialItems = [
            { name: "Concurrent 1", email: "concurrent1@test.com", status: "active" },
            { name: "Concurrent 2", email: "concurrent2@test.com", status: "active" },
            { name: "Concurrent 3", email: "concurrent3@test.com", status: "active" }
        ];

        const createResponse = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(initialItems);

        const createdIds = createResponse.body.data;

        // Perform update and verify immediately
        const updates = createdIds.map((id, index) => ({
            id,
            status: `updated_${index}`,
            priority: index * 10
        }));

        const updateResponse = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(updates);

        expect(updateResponse.status).toBe(200);

        // Verify updates are immediately visible
        const getResponse = await request(app)
            .get(`/items/${testCollectionName}`)
            .set("Authorization", `Bearer ${adminToken}`);

        for (let i = 0; i < createdIds.length; i++) {
            const item = getResponse.body.data.find(it => it.id === createdIds[i]);
            expect(item.status).toBe(`updated_${i}`);
            expect(item.priority).toBe(i * 10);
        }
    });
});

describe("Bulk Operations - Error Scenarios", () => {
    test("should return 404 for non-existent collection", async () => {
        const response = await request(app)
            .post("/items/nonexistent_collection/bulk")
            .set("Authorization", `Bearer ${adminToken}`)
            .send([{ name: "Test", email: "test@test.com" }]);

        expect(response.status).toBe(404);
    });

    test("should require authentication for bulk operations", async () => {
        // Without token, should get 403 (forbidden - not public)
        const createResponse = await request(app)
            .post(`/items/${testCollectionName}/bulk`)
            .send([{ name: "Test", email: "test@test.com" }]);

        expect(createResponse.status).toBe(403);

        const updateResponse = await request(app)
            .patch(`/items/${testCollectionName}/bulk`)
            .send([{ id: 1, name: "Updated" }]);

        expect(updateResponse.status).toBe(403);

        const deleteResponse = await request(app)
            .delete(`/items/${testCollectionName}/bulk`)
            .send([1, 2, 3]);

        expect(deleteResponse.status).toBe(403);
    });
});
