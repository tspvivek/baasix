import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create necessary schemas
    await setupTestSchemas();
    // Create test data
    await setupTestData();
});

async function setupTestSchemas() {
    // Create Product schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "products",
            schema: {
                name: "Product",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    description: { type: "String" },
                },
            },
        });

    // Create CustomerProduct schema with M2O to Product
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "customer_products",
            schema: {
                name: "CustomerProduct",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    customer_name: { type: "String", allowNull: false },
                },
            },
        });

    // Create ProductContract schema with M2O to Product
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "product_contracts",
            schema: {
                name: "ProductContract",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    contract_number: { type: "String", allowNull: false },
                    contract_date: { type: "DateTime", allowNull: false },
                },
            },
        });

    // Add relationship between CustomerProduct and Product
    await request(app)
        .post("/schemas/customer_products/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            type: "M2O",
            target: "products",
            name: "product",
            alias: "customer_products",
        });

    // Add relationship between ProductContract and Product
    await request(app)
        .post("/schemas/product_contracts/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            type: "M2O",
            target: "products",
            name: "product",
            alias: "product_contracts",
        });
}

async function setupTestData() {
    // Create test product
    const productResponse = await request(app)
        .post("/items/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Test Product",
            description: "Test Product Description",
        });
    const productId = productResponse.body.data.id;

    // Create multiple customer products
    const customerProducts = [
        { customer_name: "Customer 1", product_id: productId },
        { customer_name: "Customer 2", product_id: productId },
        { customer_name: "Customer 3", product_id: productId },
        { customer_name: "Customer 4", product_id: productId },
    ];

    for (const cp of customerProducts) {
        await request(app).post("/items/customer_products").set("Authorization", `Bearer ${adminToken}`).send(cp);
    }

    // Create multiple product contracts
    const productContracts = [
        { contract_number: "CTR-001", contract_date: new Date(), product_id: productId },
        { contract_number: "CTR-002", contract_date: new Date(), product_id: productId },
        { contract_number: "CTR-003", contract_date: new Date(), product_id: productId },
        { contract_number: "CTR-004", contract_date: new Date(), product_id: productId },
    ];

    for (const pc of productContracts) {
        await request(app).post("/items/product_contracts").set("Authorization", `Bearer ${adminToken}`).send(pc);
    }
}

describe("Nested HasMany Relationships Tests", () => {
    test("should retrieve all customer products with their associated product contracts", async () => {


        const response2 = await request(app)
        .get("/items/customer_products")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({
            fields: ["*", "product.*", "product.product_contracts.*"],
            filter: JSON.stringify({
                "product.product_contracts.contract_number": {
                    ne: null,
                },
            }),
            limit: 3,
            page: 2,
            sort: [{ customer_name: "asc" }],
        });

    console.log(JSON.stringify(response2.body, null, 2));

        const response = await request(app)
            .get("/items/customer_products")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                fields: ["*", "product.*", "product.product_contracts.*"],
                filter: JSON.stringify({
                    "product.product_contracts.contract_number": {
                        ne: null,
                    },
                }),
                limit: 3,
                page: 1,
                sort: [{ customer_name: "asc" }],
            });

        console.log(JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3); // Should have all 3 customer products

        // Verify each customer product has access to all product contracts
        response.body.data.forEach((customerProduct) => {
            expect(customerProduct.product).toBeDefined();
            expect(customerProduct.product.product_contracts).toHaveLength(4); // Should have all 4 contracts
        });

        // Verify the contract details
        const contracts = response.body.data[0].product.product_contracts;
        expect(contracts.some((c) => c.contract_number === "CTR-001")).toBe(true);
        expect(contracts.some((c) => c.contract_number === "CTR-002")).toBe(true);
        expect(contracts.some((c) => c.contract_number === "CTR-003")).toBe(true);
        expect(contracts.some((c) => c.contract_number === "CTR-004")).toBe(true);
    });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
