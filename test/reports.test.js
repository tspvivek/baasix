import request from "supertest";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";

let app;
let adminToken;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create categories collection
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "categories",
            schema: {
                name: "Category",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    name: { type: "String", allowNull: false },
                    description: { type: "Text" },
                },
            },
        });

    // Create products collection with relationship to categories
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
                    categoryId: {
                        type: "Integer",
                        allowNull: false,
                        relType: "BelongsTo",
                        target: "categories",
                        foreignKey: "categoryId",
                        as: "category",
                    },
                },
            },
        });

    // Insert test categories
    const testCategories = [
        { name: "Electronics", description: "Electronic devices" },
        { name: "Clothing", description: "Apparel and fashion" },
        { name: "Books", description: "Literature and textbooks" },
    ];

    for (const category of testCategories) {
        await request(app).post("/items/categories").set("Authorization", `Bearer ${adminToken}`).send(category);
    }

    // Insert test products
    const testProducts = [
        { name: "Laptop", price: 999.99, categoryId: 1 },
        { name: "Phone", price: 699.99, categoryId: 1 },
        { name: "T-Shirt", price: 19.99, categoryId: 2 },
        { name: "Jeans", price: 79.99, categoryId: 2 },
        { name: "Novel", price: 14.99, categoryId: 3 },
        { name: "Textbook", price: 129.99, categoryId: 3 },
    ];

    for (const product of testProducts) {
        await request(app).post("/items/products").set("Authorization", `Bearer ${adminToken}`).send(product);
    }

    // Create orders schema for date-based testing
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
                    categoryId: {
                        type: "Integer",
                        allowNull: false,
                        relType: "BelongsTo",
                        target: "categories",
                        foreignKey: "categoryId",
                        as: "category",
                    },
                },
            },
        });

    // Insert test orders with specific dates for date grouping tests
    const testOrders = [
        // January 2024 orders
        { amount: 100, status: "completed", createdAt: "2024-01-01T10:00:00Z", categoryId: 1 },
        { amount: 150, status: "completed", createdAt: "2024-01-02T14:00:00Z", categoryId: 1 },
        { amount: 200, status: "pending", createdAt: "2024-01-15T09:00:00Z", categoryId: 2 },
        
        // February 2024 orders
        { amount: 300, status: "completed", createdAt: "2024-02-01T11:00:00Z", categoryId: 2 },
        { amount: 250, status: "completed", createdAt: "2024-02-15T16:00:00Z", categoryId: 3 },
        
        // March 2024 orders (different weeks)
        { amount: 400, status: "completed", createdAt: "2024-03-05T08:00:00Z", categoryId: 1 }, // Week 10
        { amount: 350, status: "completed", createdAt: "2024-03-15T20:00:00Z", categoryId: 2 }, // Week 11
    ];

    for (const order of testOrders) {
        await request(app).post("/items/orders").set("Authorization", `Bearer ${adminToken}`).send(order);
    }
}, 60000);

afterAll(async () => {
    await destroyAllTablesInDB();
});

describe("New ReportService Tests", () => {
    test("should work like ItemsService with no groupBy", async () => {
        const response = await request(app)
            .post("/reports/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                fields: ["name", "price"],
                filter: { categoryId: 1 },
                limit: 10
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0]).toHaveProperty("price");
    });

    test("should handle groupBy with aggregates (no related fields)", async () => {
        const response = await request(app)
            .post("/reports/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                groupBy: ["categoryId"],
                aggregate: {
                    avg_price: { function: "avg", field: "price" },
                    count: { function: "count", field: "*" }
                },
                fields: ["categoryId"]
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);
        response.body.data.forEach(item => {
            expect(item).toHaveProperty("categoryId");
            expect(item).toHaveProperty("avg_price");
            expect(item).toHaveProperty("count");
            expect(parseInt(item.count)).toBe(2);
        });
    });

    test("should handle groupBy with dot notation fields - two step approach", async () => {
        // This test should demonstrate the two-step approach:
        // Step 1: Get aggregated data by categoryId 
        // Step 2: Get related category data using dot notation and merge
        
        const response = await request(app)
            .post("/reports/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                groupBy: ["categoryId"],
                aggregate: {
                    avg_price: { function: "avg", field: "price" },
                    product_count: { function: "count", field: "id" }
                },
                fields: ["categoryId", "category.name", "category.description"] // This should trigger the two-step approach
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);

        console.info("Two-step report response:", JSON.stringify(response.body, null, 2));
        
        response.body.data.forEach(item => {
            expect(item).toHaveProperty("categoryId");
            expect(item).toHaveProperty("avg_price");
            expect(item).toHaveProperty("product_count");
            expect(parseInt(item.product_count)).toBe(2);
            
            // These should come from step 2 - merged category data via dot notation
            // ItemsService returns nested objects for relational fields
            expect(item).toHaveProperty("category");
            expect(item.category).toHaveProperty("name");
            expect(item.category).toHaveProperty("description");
        });
    });

    test("should demonstrate the efficiency - no dot notation should use single query", async () => {
        // This should go directly to ItemsService without two-step approach
        const response = await request(app)
            .post("/reports/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                groupBy: ["categoryId"],
                aggregate: {
                    total_count: { function: "count", field: "*" },
                    avg_price: { function: "avg", field: "price" }
                },
                fields: ["categoryId"] // No dot notation, should be single query
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);
        
        response.body.data.forEach(item => {
            expect(item).toHaveProperty("categoryId");
            expect(item).toHaveProperty("total_count");
            expect(item).toHaveProperty("avg_price");
            expect(parseInt(item.total_count)).toBe(2);
        });
    });

    test("should handle actual dot notation with relationship (properly created)", async () => {
        // Now test with actual dot notation using the relationship defined in schema
        const response = await request(app)
            .post("/reports/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                groupBy: ["categoryId"],
                aggregate: {
                    avg_price: { function: "avg", field: "price" },
                    product_count: { function: "count", field: "*" }
                },
                fields: ["categoryId", "category.name", "category.description"] // Real dot notation
            });

        console.log("Dot notation test response status:", response.status);
        console.log("Dot notation test response:", JSON.stringify(response.body, null, 2));
        
        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);
        
        response.body.data.forEach(item => {
            expect(item).toHaveProperty("categoryId");
            expect(item).toHaveProperty("avg_price");
            expect(item).toHaveProperty("product_count");
            expect(parseInt(item.product_count)).toBe(2);
            
            // These should come from the related category data via dot notation
            // ItemsService returns nested objects for relational fields
            if (item.category) {
                expect(item.category).toHaveProperty("name");
                expect(item.category).toHaveProperty("description");
            }
        });
    });

    test("should group by ID and date with relational fields - two step approach", async () => {
        // This should trigger the two-step approach:
        // Group by categoryId + date:year:createdAt, then get category.name via two-step
        const response = await request(app)
            .post("/reports/orders")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                groupBy: ["categoryId", "date:year:createdAt"],
                aggregate: {
                    yearly_total: { function: "sum", field: "amount" },
                    order_count: { function: "count", field: "id" }
                },
                fields: ["categoryId", "date:year:createdAt", "category.name", "category.description"]
            });

        console.info("ID and date grouping with relations response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThan(2); // Multiple category-year combinations
        
        response.body.data.forEach(item => {
            expect(item).toHaveProperty("categoryId");
            expect(item).toHaveProperty("year_createdAt");
            expect(item).toHaveProperty("yearly_total");
            expect(item).toHaveProperty("order_count");
            
            // These should come from step 2 - merged category data via dot notation
            expect(item).toHaveProperty("category");
            expect(item.category).toHaveProperty("name");
            expect(item.category).toHaveProperty("description");
            
            // Verify the data makes sense
            expect(Number(item.year_createdAt)).toBe(2024);
            expect(Number(item.categoryId)).toBeGreaterThan(0);
            expect(Number(item.yearly_total)).toBeGreaterThan(0);
            expect(Number(item.order_count)).toBeGreaterThan(0);
        });
    });

    describe("Day of week functions tests", () => {
        test("should group orders by day of week (DOW)", async () => {
            const response = await request(app)
                .post("/reports/orders")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    groupBy: ["date:dow:createdAt"],
                    aggregate: {
                        daily_total: { function: "sum", field: "amount" },
                        order_count: { function: "count", field: "id" }
                    }
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThan(0);
            
            // DOW: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
            response.body.data.forEach(item => {
                expect(item).toHaveProperty("dow_createdAt");
                expect(item).toHaveProperty("daily_total");
                expect(item).toHaveProperty("order_count");
                expect(Number(item.dow_createdAt)).toBeGreaterThanOrEqual(0);
                expect(Number(item.dow_createdAt)).toBeLessThanOrEqual(6);
            });

            console.info("DOW grouping response:", JSON.stringify(response.body, null, 2));
        });

        test("should group orders by ISO day of week (ISODOW)", async () => {
            const response = await request(app)
                .post("/reports/orders")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    groupBy: ["date:isodow:createdAt"],
                    aggregate: {
                        weekly_total: { function: "sum", field: "amount" },
                        order_count: { function: "count", field: "id" }
                    }
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThan(0);
            
            // ISODOW: 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday, 7=Sunday
            response.body.data.forEach(item => {
                expect(item).toHaveProperty("isodow_createdAt");
                expect(item).toHaveProperty("weekly_total");
                expect(item).toHaveProperty("order_count");
                expect(Number(item.isodow_createdAt)).toBeGreaterThanOrEqual(1);
                expect(Number(item.isodow_createdAt)).toBeLessThanOrEqual(7);
            });

            console.info("ISODOW grouping response:", JSON.stringify(response.body, null, 2));
        });

        test("should handle dow with relational fields - two step approach", async () => {
            const response = await request(app)
                .post("/reports/orders")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    groupBy: ["categoryId", "date:dow:createdAt"],
                    aggregate: {
                        dow_total: { function: "sum", field: "amount" },
                        order_count: { function: "count", field: "id" }
                    },
                    fields: ["categoryId", "date:dow:createdAt", "category.name"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThan(0);
            
            response.body.data.forEach(item => {
                expect(item).toHaveProperty("categoryId");
                expect(item).toHaveProperty("dow_createdAt");
                expect(item).toHaveProperty("dow_total");
                expect(item).toHaveProperty("order_count");
                expect(item).toHaveProperty("category");
                expect(item.category).toHaveProperty("name");
                
                // Verify DOW range
                expect(Number(item.dow_createdAt)).toBeGreaterThanOrEqual(0);
                expect(Number(item.dow_createdAt)).toBeLessThanOrEqual(6);
            });
        });
    });

    describe("Stats endpoint tests", () => {
        test("should handle multiple stats queries for different collections", async () => {
            const response = await request(app)
                .post("/reports/stats")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    stats: [
                        {
                            name: "total_products",
                            collection: "products",
                            query: {
                                aggregate: {
                                    count: { function: "count", field: "*" }
                                }
                            }
                        },
                        {
                            name: "total_orders",
                            collection: "orders",
                            query: {
                                aggregate: {
                                    count: { function: "count", field: "*" },
                                    total_amount: { function: "sum", field: "amount" }
                                }
                            }
                        },
                        {
                            name: "products_by_category",
                            collection: "products",
                            query: {
                                groupBy: ["categoryId"],
                                aggregate: {
                                    count: { function: "count", field: "id" },
                                    avg_price: { function: "avg", field: "price" }
                                },
                                fields: ["categoryId", "category.name"]
                            }
                        }
                    ]
                });

            console.info("Stats response:", JSON.stringify(response.body, null, 2));

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("data");
            expect(response.body).toHaveProperty("totalStats", 3);
            expect(response.body).toHaveProperty("successfulStats", 3);

            // Check individual stats results
            expect(response.body.data).toHaveProperty("total_products");
            expect(response.body.data).toHaveProperty("total_orders");
            expect(response.body.data).toHaveProperty("products_by_category");

            // Verify total products count
            expect(Number(response.body.data.total_products.data[0].count)).toBe(6);

            // Verify total orders stats
            expect(Number(response.body.data.total_orders.data[0].count)).toBe(7);
            expect(Number(response.body.data.total_orders.data[0].total_amount)).toBe(1750);

            // Verify products by category has the expected structure
            expect(response.body.data.products_by_category.data).toHaveLength(3);
            response.body.data.products_by_category.data.forEach(item => {
                expect(item).toHaveProperty("categoryId");
                expect(item).toHaveProperty("count");
                expect(item).toHaveProperty("avg_price");
                expect(item).toHaveProperty("category");
                expect(item.category).toHaveProperty("name");
            });
        });

        test("should handle mixed collection stats queries with date grouping", async () => {
            const response = await request(app)
                .post("/reports/stats")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    stats: [
                        {
                            name: "orders_by_month",
                            collection: "orders",
                            query: {
                                groupBy: ["date:month:createdAt"],
                                aggregate: {
                                    monthly_total: { function: "sum", field: "amount" },
                                    order_count: { function: "count", field: "id" }
                                }
                            }
                        },
                        {
                            name: "products_summary", 
                            collection: "products",
                            query: {
                                aggregate: {
                                    count: { function: "count", field: "*" },
                                    avg_price: { function: "avg", field: "price" }
                                }
                            }
                        },
                        {
                            name: "category_year_stats",
                            collection: "orders",
                            query: {
                                groupBy: ["categoryId", "date:year:createdAt"],
                                aggregate: {
                                    yearly_total: { function: "sum", field: "amount" },
                                    order_count: { function: "count", field: "id" }
                                },
                                fields: ["categoryId", "date:year:createdAt", "category.name"]
                            }
                        }
                    ]
                });

            expect(response.status).toBe(200);
            expect(response.body.totalStats).toBe(3);
            expect(response.body.successfulStats).toBe(3);

            // Verify orders by month
            expect(response.body.data.orders_by_month.data).toHaveLength(3); // 3 months

            // Verify products summary
            expect(response.body.data.products_summary.data).toHaveLength(1);
            expect(Number(response.body.data.products_summary.data[0].count)).toBe(6);
            
            // Verify category year stats with relations
            expect(response.body.data.category_year_stats.data.length).toBeGreaterThan(2);
            response.body.data.category_year_stats.data.forEach(item => {
                expect(item).toHaveProperty("categoryId");
                expect(item).toHaveProperty("year_createdAt");
                expect(item).toHaveProperty("yearly_total");
                expect(item).toHaveProperty("order_count");
                expect(item).toHaveProperty("category");
            });
        });

        test("should return error for empty stats array", async () => {
            const response = await request(app)
                .post("/reports/stats")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    stats: []
                });

            expect(response.status).toBe(400);
        });

        test("should return error for missing stats array", async () => {
            const response = await request(app)
                .post("/reports/stats")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({});

            expect(response.status).toBe(400);
        });

        test("should return error for missing collection in stats query", async () => {
            const response = await request(app)
                .post("/reports/stats")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    stats: [
                        {
                            name: "invalid_stat",
                            query: {
                                aggregate: {
                                    count: { function: "count", field: "*" }
                                }
                            }
                            // missing collection property
                        }
                    ]
                });

            expect(response.status).toBe(400);
        });

        test("should return error for invalid collection", async () => {
            const response = await request(app)
                .post("/reports/stats")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    stats: [
                        {
                            name: "invalid_collection_stat",
                            collection: "nonexistent_collection",
                            query: {
                                aggregate: {
                                    count: { function: "count", field: "*" }
                                }
                            }
                        }
                    ]
                });

            expect(response.status).toBe(404);
        });
    });

});