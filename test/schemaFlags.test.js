import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe, afterAll, beforeEach } from "@jest/globals";

let app;
let adminToken;

const testSchema = {
    name: "FlagTestModel",
    fields: {
        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
        name: { type: "String", allowNull: false },
        description: { type: "String", allowNull: true },
    },
};

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Log in as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;
});

describe("Schema Flag Tests", () => {
    beforeEach(async () => {
        // Clean up the test model before each test
        try {
            await request(app).delete("/schemas/FlagTestModel").set("Authorization", `Bearer ${adminToken}`);
        } catch (error) {
            // Ignore errors if model doesn't exist
        }
    });

    test("Create schema with usertrack enabled", async () => {
        // Create schema with usertrack flag enabled
        const schemaWithUsertrack = {
            ...testSchema,
            usertrack: true,
        };

        const response = await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "FlagTestModel",
            schema: schemaWithUsertrack,
        });

        expect(response.status).toBe(201);

        // Get the schema to verify usertrack fields were added
        const getResponse = await request(app)
            .get("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data.schema.usertrack).toBe(true);
        expect(getResponse.body.data.schema.fields.userCreated_Id).toBeDefined();
        expect(getResponse.body.data.schema.fields.userUpdated_Id).toBeDefined();

        // Create a test item to verify the model works correctly with timestamps
        const testItem = {
            name: "Test Item",
            description: "Test Description",
        };

        const createItemResponse = await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(testItem);

        //Get the created item to verify usertrack fields
        const getCreatedItemResponse = await request(app)
            .get(`/items/FlagTestModel/${createItemResponse.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getCreatedItemResponse.status).toBe(200);
        expect(getCreatedItemResponse.body.data.userCreated_Id).toBeDefined();
    });

    test("Create schema with sortEnabled flag", async () => {
        // Create schema with sortEnabled flag
        const schemaWithSort = {
            ...testSchema,
            sortEnabled: true,
        };

        const response = await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "FlagTestModel",
            schema: schemaWithSort,
        });

        expect(response.status).toBe(201);

        // Get the schema to verify sort field was added
        const getResponse = await request(app)
            .get("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data.schema.sortEnabled).toBe(true);
        expect(getResponse.body.data.schema.fields.sort).toBeDefined();

        // Create some items to test sort functionality
        await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Item 1", description: "First item" });

        await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Item 2", description: "Second item" });

        // Get items to verify they have sort field
        const getItemsResponse = await request(app)
            .get("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getItemsResponse.status).toBe(200);
        expect(getItemsResponse.body.data[0].sort).toBeDefined();
        expect(getItemsResponse.body.data[1].sort).toBeDefined();
    });

    test("Create schema with timestamps flag", async () => {
        // Create schema with timestamps flag
        const schemaWithTimestamps = {
            ...testSchema,
            timestamps: true,
        };

        const response = await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "FlagTestModel",
            schema: schemaWithTimestamps,
        });

        expect(response.status).toBe(201);

        // Get the schema to verify timestamps flag
        const getResponse = await request(app)
            .get("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data.schema.timestamps).toBe(true);

        // Create a test item to verify timestamps
        const createItemResponse = await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Time Test", description: "Testing timestamps" });

        const getCreatedItemResponse = await request(app)
            .get(`/items/FlagTestModel/${createItemResponse.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getCreatedItemResponse.status).toBe(200);
        expect(getCreatedItemResponse.body.data.createdAt).toBeDefined();
        expect(getCreatedItemResponse.body.data.updatedAt).toBeDefined();
    });

    test("Create schema with paranoid flag", async () => {
        // Create schema with paranoid flag
        const schemaWithParanoid = {
            ...testSchema,
            paranoid: true,
        };

        const response = await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "FlagTestModel",
            schema: schemaWithParanoid,
        });

        expect(response.status).toBe(201);

        // Get the schema to verify paranoid flag
        const getResponse = await request(app)
            .get("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data.schema.paranoid).toBe(true);

        // Create and then soft-delete an item to test paranoid
        const createItemResponse = await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Deletable Item", description: "Will be soft-deleted" });

        const itemId = createItemResponse.body.data.id;

        // Delete the item (which should be a soft delete due to paranoid mode)
        await request(app).delete(`/items/FlagTestModel/${itemId}`).set("Authorization", `Bearer ${adminToken}`);

        // Try to get the deleted item
        const getDeletedResponse = await request(app)
            .get(`/items/FlagTestModel/${itemId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        // Should return 404 since the item is soft-deleted
        expect(getDeletedResponse.status).toBe(403);
    });

    test("Update schema to add usertrack flag", async () => {
        // First create schema without usertrack
        await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "FlagTestModel",
            schema: testSchema,
        });

        // Now update the schema to enable usertrack
        const updatedSchema = {
            ...testSchema,
            usertrack: true,
        };

        const updateResponse = await request(app)
            .patch("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ schema: updatedSchema });

        expect(updateResponse.status).toBe(200);

        // Get the schema to verify usertrack fields were added
        const getResponse = await request(app)
            .get("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data.schema.usertrack).toBe(true);
        expect(getResponse.body.data.schema.fields.userCreated_Id).toBeDefined();
        expect(getResponse.body.data.schema.fields.userUpdated_Id).toBeDefined();

        // Create an item to verify usertrack fields
        const createItemResponse = await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Update Test", description: "Testing after usertrack update" });

        const getCreatedItemResponse = await request(app)
            .get(`/items/FlagTestModel/${createItemResponse.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getCreatedItemResponse.status).toBe(200);
        expect(getCreatedItemResponse.body.data.userCreated_Id).toBeDefined();
    });

    test("Update schema to add sortEnabled flag", async () => {
        // First create schema without sortEnabled
        await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "FlagTestModel",
            schema: testSchema,
        });

        // Now update the schema to enable sortEnabled
        const updatedSchema = {
            ...testSchema,
            sortEnabled: true,
        };

        const updateResponse = await request(app)
            .patch("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ schema: updatedSchema });

        expect(updateResponse.status).toBe(200);

        // Get the schema to verify sort field was added
        const getResponse = await request(app)
            .get("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data.schema.sortEnabled).toBe(true);
        expect(getResponse.body.data.schema.fields.sort).toBeDefined();

        // Create items to verify sort works
        await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Sort Item 1", description: "Should have sort field" });

        await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Sort Item 2", description: "Should have sort field too" });

        // Get items to verify they have sort values
        const getItemsResponse = await request(app)
            .get("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getItemsResponse.status).toBe(200);
        expect(getItemsResponse.body.data[0].sort).toBeDefined();
        expect(getItemsResponse.body.data[1].sort).toBeDefined();
    });

    test("Update schema to toggle multiple flags", async () => {
        // First create schema without flags
        await request(app).post("/schemas").set("Authorization", `Bearer ${adminToken}`).send({
            collectionName: "FlagTestModel",
            schema: testSchema,
        });

        // Update with all flags enabled
        const fullyFlaggedSchema = {
            ...testSchema,
            timestamps: true,
            paranoid: true,
            usertrack: true,
            sortEnabled: true,
        };

        const updateResponse = await request(app)
            .patch("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ schema: fullyFlaggedSchema });

        expect(updateResponse.status).toBe(200);

        // Get the schema to verify all flags
        const getResponse = await request(app)
            .get("/schemas/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);

        // Validate schema has all flags set
        const schema = getResponse.body.data.schema;
        expect(schema.timestamps).toBe(true);
        expect(schema.paranoid).toBe(true);
        expect(schema.usertrack).toBe(true);
        expect(schema.sortEnabled).toBe(true);

        // Verify fields
        expect(schema.fields.userCreated_Id).toBeDefined();
        expect(schema.fields.userUpdated_Id).toBeDefined();
        expect(schema.fields.sort).toBeDefined();

        // Create an item to test all features together
        const createItemResponse = await request(app)
            .post("/items/FlagTestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Multi-flag Item", description: "Testing all flags together" });

        const getCreatedItemResponse = await request(app)
            .get(`/items/FlagTestModel/${createItemResponse.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getCreatedItemResponse.status).toBe(200);
        const item = getCreatedItemResponse.body.data;

        // Check timestamp fields
        expect(item.createdAt).toBeDefined();
        expect(item.updatedAt).toBeDefined();

        // Check usertrack fields
        expect(item.userCreated_Id).toBeDefined();

        // Check sort field
        expect(item.sort).toBeDefined();

        // Test paranoid (soft delete)
        await request(app).delete(`/items/FlagTestModel/${item.id}`).set("Authorization", `Bearer ${adminToken}`);

        const getDeletedResponse = await request(app)
            .get(`/items/FlagTestModel/${item.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getDeletedResponse.status).toBe(403);
    });
});
