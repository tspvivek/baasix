import request from "supertest";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";

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

    console.log("adminLoginResponse.body", adminLoginResponse.body);

    // Create test schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "products",
            schema: {
                name: "Product",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    name: { type: "String", allowNull: false },
                    price: { type: "Double", allowNull: false },
                    categoryId: { type: "Integer", allowNull: false },
                },
            },
        });

    // Insert test data
    const testProducts = [
        { name: "Product 1", price: 10.99, categoryId: 1 },
        { name: "Product 2", price: 20.99, categoryId: 1 },
        { name: "Product 3", price: 15.99, categoryId: 2 },
        { name: "Product 4", price: 25.99, categoryId: 2 },
        { name: "Product 5", price: 30.99, categoryId: 3 },
    ];

    for (const product of testProducts) {
        await request(app).post("/items/products").set("Authorization", `Bearer ${adminToken}`).send(product);
    }

    // Create user schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "order_users",
            schema: {
                name: "OrderUser",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    name: { type: "String", allowNull: false },
                    type: { type: "String", allowNull: false },
                    status: { type: "String", allowNull: false },
                },
            },
        });

    // Create test orders schema with relation to user
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "orders",
            schema: {
                name: "Order",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    amount: { type: "Double", allowNull: false },
                    status: { type: "String", allowNull: false },
                    createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    userId: {
                        type: "Integer",
                        relType: "BelongsTo",
                        target: "order_users",
                        foreignKey: "userId",
                        as: "user",
                    },
                },
            },
        });

    // Create test users
    const users = [
        { name: "Regular Customer", type: "retail", status: "active" },
        { name: "Premium Customer", type: "premium", status: "active" },
        { name: "Wholesale Buyer", type: "wholesale", status: "active" },
    ];

    const createdUsers = [];
    for (const user of users) {
        const response = await request(app)
            .post("/items/order_users")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(user);
        createdUsers.push(response.body.data);
    }

    // Insert test orders with user relationships
    const testOrders = [
        { amount: 100, status: "completed", createdAt: "2024-01-01T10:00:00Z", userId: createdUsers[0].id },
        { amount: 150, status: "completed", createdAt: "2024-01-01T14:00:00Z", userId: createdUsers[1].id },
        { amount: 200, status: "completed", createdAt: "2024-01-15T09:00:00Z", userId: createdUsers[2].id },
        { amount: 300, status: "completed", createdAt: "2024-02-01T11:00:00Z", userId: createdUsers[0].id },
        { amount: 250, status: "completed", createdAt: "2024-02-15T16:00:00Z", userId: createdUsers[1].id },
    ];

    for (const order of testOrders) {
        await request(app).post("/items/orders").set("Authorization", `Bearer ${adminToken}`).send(order);
    }
});

describe("Aggregate Attributes", () => {
    test("Get maximum price of products", async () => {
        const response = await request(app)
            .get("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({ maxPrice: { function: "max", field: "price" } }),
            });

        console.log("response.body", response.body);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        // max() returns string from PostgreSQL
        expect(response.body.data[0].maxPrice).toBe("30.99");
        expect(response.body.totalCount).toBe(1);
    });

    test("Get average price for each category", async () => {
        const response = await request(app)
            .get("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({ avgPrice: { function: "avg", field: "price" } }),
                groupBy: "categoryId",
                sort: { avgPrice: "asc" },
                limit: 5,
                page: 1,
            });

        console.log("response 2", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);
        expect(response.body.data[0].avgPrice).toBeCloseTo(15.99, 2);
        expect(response.body.data[0].categoryId).toBe(1);
        expect(response.body.data[1].avgPrice).toBeCloseTo(20.99, 2);
        expect(response.body.data[1].categoryId).toBe(2);
        expect(response.body.data[2].avgPrice).toBe(30.99);
        expect(response.body.data[2].categoryId).toBe(3);
        expect(response.body.totalCount).toBe(3);
    });

    test("Get count of products for each category", async () => {
        const response = await request(app)
            .get("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({ productCount: { function: "count", field: "id" } }),
                groupBy: "categoryId",
                sort: { categoryId: "asc" },
            });

        console.log("response 3", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);
        // count() returns number from Drizzle
        expect(response.body.data[0].productCount).toBe(2);
        expect(response.body.data[0].categoryId).toBe(1);
        expect(response.body.data[1].productCount).toBe(2);
        expect(response.body.data[1].categoryId).toBe(2);
        expect(response.body.data[2].productCount).toBe(1);
        expect(response.body.data[2].categoryId).toBe(3);
        expect(response.body.totalCount).toBe(3);
    });

    test("Get multiple aggregations", async () => {
        const response = await request(app)
            .get("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({
                    minPrice: { function: "min", field: "price" },
                    maxPrice: { function: "max", field: "price" },
                    avgPrice: { function: "avg", field: "price" },
                    totalProducts: { function: "count", field: "id" },
                }),
            });

        console.log("response 4", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        // min/max return strings from PostgreSQL
        expect(response.body.data[0].minPrice).toBe("10.99");
        expect(response.body.data[0].maxPrice).toBe("30.99");
        // avg returns number (uses .mapWith(Number))
        expect(response.body.data[0].avgPrice).toBeCloseTo(20.99, 2);
        // count returns number from Drizzle
        expect(response.body.data[0].totalProducts).toBe(5);
        expect(response.body.totalCount).toBe(1);
    });
});

describe("Aggregate Functions with Date Grouping", () => {
    test("Group by year with sum aggregate", async () => {
        const response = await request(app)
            .get("/items/orders")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({
                    total: { function: "sum", field: "amount" },
                }),
                groupBy: ["date:year:createdAt"],
            });

        console.log("Year grouping response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(Number(response.body.data[0].total)).toBe(1000); // Total of all orders
        expect(Number(response.body.data[0].year_createdAt)).toBe(2024);
    });

    test("Group by month with count aggregate", async () => {
        const response = await request(app)
            .get("/items/orders")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({
                    order_count: { function: "count", field: "id" },
                }),
                groupBy: ["date:month:createdAt"],
            });

        console.log("Month grouping response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
        const months = response.body.data
            .map((d) => ({
                month: Number(d.month_createdAt),
                count: Number(d.order_count),
            }))
            .sort((a, b) => a.month - b.month);

        expect(months[0]).toEqual({ month: 1, count: 3 }); // January: 3 orders
        expect(months[1]).toEqual({ month: 2, count: 2 }); // February: 2 orders
    });

    test("Group by year and month with multiple aggregates", async () => {
        const response = await request(app)
            .get("/items/orders")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({
                    total_amount: { function: "sum", field: "amount" },
                    average_amount: { function: "avg", field: "amount" },
                }),
                groupBy: ["date:year:createdAt", "date:month:createdAt"],
            });

        console.log("Year and month grouping response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);

        const januaryData = response.body.data.find(
            (d) => Number(d.month_createdAt) === 1 && Number(d.year_createdAt) === 2024
        );
        expect(Number(januaryData.total_amount)).toBe(450);
        expect(Number(januaryData.average_amount)).toBeCloseTo(150);

        const februaryData = response.body.data.find(
            (d) => Number(d.month_createdAt) === 2 && Number(d.year_createdAt) === 2024
        );
        expect(Number(februaryData.total_amount)).toBe(550);
        expect(Number(februaryData.average_amount)).toBeCloseTo(275);
    });

    test("Aggregate orders with relational filtering by user type", async () => {
        const response = await request(app)
            .get("/items/orders")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({
                    total_amount: { function: "sum", field: "amount" },
                    average_order: { function: "avg", field: "amount" },
                    order_count: { function: "count", field: "id" },
                }),
                filter: JSON.stringify({
                    "user.type": { eq: "premium" },
                }),
                groupBy: ["user.id"],
            });

        console.log("Aggregate with relation response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);

        const aggregateResult = response.body.data[0];
        expect(Number(aggregateResult.total_amount)).toBe(400); // Sum of premium user orders (150 + 250)
        expect(Number(aggregateResult.order_count)).toBe(2); // Count of premium user orders
        expect(Number(aggregateResult.average_order)).toBe(200); // Average of premium user orders
    });

    test("Aggregate orders with grouping by user type", async () => {
        const response = await request(app)
            .get("/items/orders")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                aggregate: JSON.stringify({
                    total_amount: { function: "sum", field: "amount" },
                    average_order: { function: "avg", field: "amount" },
                    order_count: { function: "count", field: "id" },
                    user_count: { function: "count", field: "user.id" },
                }),
                groupBy: ["user.type"],
                sort: { total_amount: "desc" },
                filter: JSON.stringify({
                    "user.id": { not: null },
                }),
            });

        console.info("Aggregate by user type response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3); // One result per user type

        // Verify aggregates for each user type
        const retailOrders = response.body.data.find((d) => d.user_type === "retail");
        const premiumOrders = response.body.data.find((d) => d.user_type === "premium");
        const wholesaleOrders = response.body.data.find((d) => d.user_type === "wholesale");

        // Check retail customer aggregates
        expect(Number(retailOrders.total_amount)).toBe(400); // 100 + 300
        expect(Number(retailOrders.order_count)).toBe(2);
        expect(Number(retailOrders.average_order)).toBe(200);

        // Check premium customer aggregates
        expect(Number(premiumOrders.total_amount)).toBe(400); // 150 + 250
        expect(Number(premiumOrders.order_count)).toBe(2);
        expect(Number(premiumOrders.average_order)).toBe(200);

        // Check wholesale customer aggregates
        expect(Number(wholesaleOrders.total_amount)).toBe(200);
        expect(Number(wholesaleOrders.order_count)).toBe(1);
        expect(Number(wholesaleOrders.average_order)).toBe(200);
    });
});

afterAll(async () => {
    // Clean up: delete the test schema
    await request(app).delete("/schemas/products").set("Authorization", `Bearer ${adminToken}`);
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
