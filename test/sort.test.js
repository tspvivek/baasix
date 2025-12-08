import request from "supertest";
import { startServerForTesting, destroyAllTablesInDB } from "../baasix";
import { beforeAll, afterAll, describe, it, expect } from "@jest/globals";

let app;
let adminToken;
const testCollection = "test_sorted_items";

// Schema definition with sortEnabled flag
// Using Integer primary key but NOT autoincrement to avoid conflict with sort field
const testSchema = {
    name: testCollection,
    sortEnabled: true,
    fields: {
        id: {
            type: "Integer",
            primaryKey: true,
            defaultValue: { type: "AUTOINCREMENT" },
        },
        name: {
            type: "String",
            allowNull: false,
        },
    },
    timestamps: true,
};

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin to get the admin token
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });

    adminToken = adminLoginResponse.body.token;

    // Create the test collection schema
    await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
        collectionName: testCollection,
        schema: testSchema,
    });

    // Create test items
    for (let i = 1; i <= 5; i++) {
        await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: `Item ${i}` });
    }
});

describe("Sort Functionality Tests", () => {
    describe("Sort Route Tests", () => {
        it("should create items with ascending sort values", async () => {
            // Get items to verify their sort values
            const response = await request(app)
                .get(`/items/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ sort: [{ sort: "asc" }] });

            const items = response.body.data;
            expect(items.length).toBe(5);

            // Verify sort values are assigned in ascending order
            for (let i = 0; i < items.length; i++) {
                expect(items[i].sort).toBe(i + 1);
            }
        });

        it("should move an item to a specific position using the sort endpoint", async () => {
            // First get all items
            const getResponse = await request(app)
                .get(`/items/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ sort: [{ sort: "asc" }] });

            const items = getResponse.body.data;

            // Move item 5 before item 2
            const response = await request(app)
                .post(`/utils/sort/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    item: items[4].id, // Item 5
                    to: items[1].id, // Item 2
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty("item");
            expect(response.body.data).toHaveProperty("collection", testCollection);

            // Get items again to check the new order
            const newGetResponse = await request(app)
                .get(`/items/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ sort: [{ sort: "asc" }] });

            const newItems = newGetResponse.body.data;
            expect(newItems.length).toBe(5);

            console.log("New items:", newItems);

            // The new order should be: Item 1, Item 5, Item 2, Item 3, Item 4
            expect(newItems[0].name).toBe("Item 1");
            expect(newItems[1].name).toBe("Item 5");
            expect(newItems[2].name).toBe("Item 2");
            expect(newItems[3].name).toBe("Item 3");
            expect(newItems[4].name).toBe("Item 4");

            // Verify sort values are continuous
            for (let i = 0; i < newItems.length; i++) {
                expect(newItems[i].sort).toBe(i + 1);
            }
        });

        it("should return 400 when trying to sort in a collection without sort enabled", async () => {
            // Create a test collection without sort enabled
            const unsortedCollection = "test_unsorted_items";
            const unsortedSchema = {
                ...testSchema,
                name: unsortedCollection,
                sortEnabled: false,
            };

            await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
                collectionName: unsortedCollection,
                schema: unsortedSchema,
            });

            // Create test items
            const item1Response = await request(app)
                .post(`/items/${unsortedCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ name: "Unsorted 1" });

            const item2Response = await request(app)
                .post(`/items/${unsortedCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ name: "Unsorted 2" });

            // Try to sort items in a collection without sort enabled
            const response = await request(app)
                .post(`/utils/sort/${unsortedCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    item: item1Response.body.data.id,
                    to: item2Response.body.data.id,
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty("error");
            expect(response.body.error.message).toContain("does not have a sort field");
        });

        it("should return 404 for non-existent items", async () => {
            // Get the first item to use as a valid target
            const getResponse = await request(app)
                .get(`/items/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ limit: 1 });

            const firstItem = getResponse.body.data[0];
            const nonExistentId = 9999;

            // Try to sort with non-existent item
            const response = await request(app)
                .post(`/utils/sort/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    item: nonExistentId,
                    to: firstItem.id,
                });

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty("error");
            expect(response.body.error.message).toContain("Item with ID");
        });

        it("should return 400 when missing required parameters", async () => {
            // Missing 'item' parameter
            let response = await request(app)
                .post(`/utils/sort/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    to: 1,
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty("error");
            expect(response.body.error.message).toContain("Missing item ID");

            // Missing 'to' parameter
            response = await request(app)
                .post(`/utils/sort/${testCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    item: 1,
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty("error");
            expect(response.body.error.message).toContain("Missing target ID");
        });

        it("should require authentication", async () => {
            const response = await request(app).post(`/utils/sort/${testCollection}`).send({
                item: 1,
                to: 2,
            });

            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty("error");
        });
    });
});
