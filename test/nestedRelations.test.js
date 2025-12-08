import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;
let userRoleId;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create test user role
    const userRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "testuser", description: "Test user role" });
    userRoleId = userRoleResponse.body.data.id;

    // Create test user
    const createUserResponse = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            firstName: "Test",
            lastName: "User",
            email: "testuser@test.com",
            password: "userpassword",
        });
    testUserId = createUserResponse.body.data.id;

    // Assign role to user
    await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
        user_Id: testUserId,
        role_Id: userRoleId,
    });

    // Login as test user
    const userLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "testuser@test.com", password: "userpassword" });
    userToken = userLoginResponse.body.token;

    // Create test schemas
    await createTestSchemas();
});

async function createTestSchemas() {
    // Department schema (for circular dependency testing)
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "departments",
            schema: {
                name: "Department",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                },
            },
        });

    // Employee schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "employees",
            schema: {
                name: "Employee",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    email: { type: "String", allowNull: false },
                },
            },
        });

    // Categories schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "categories",
            schema: {
                name: "Category",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                },
            },
        });

    // Tags schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "tags",
            schema: {
                name: "Tag",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                },
            },
        });

    // Products schema
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
                    description: { type: "String", allowNull: true },
                },
            },
        });

    // Reviews schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "reviews",
            schema: {
                name: "Review",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    content: { type: "String", allowNull: false },
                    rating: { type: "Integer", allowNull: false },
                },
            },
        });

    //Create relation between products and reviews schema with create relationships endpoint
    await request(app).post("/schemas/reviews/relationships").set("Authorization", `Bearer ${adminToken}`).send({
        type: "M2O",
        target: "products",
        foreignKey: "productId",
        name: "product",
        alias: "reviews",
    });

    //Create relation between products and categories schema with create relationships endpoint
    await request(app).post("/schemas/products/relationships").set("Authorization", `Bearer ${adminToken}`).send({
        type: "M2O",
        target: "categories",
        foreignKey: "categoryId",
        name: "categories",
        alias: "products",
    });

    //Create M2M relation between products and tags schema with create relationships endpoint
    await request(app)
        .post("/schemas/products/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            isRelationship: true,
            name: "tags",
            description: "M2M",
            type: "M2M",
            alias: "products",
            target: "tags",
            showAs: ["name"],
        });

    //Create O2O relation between manager and department schema with create relationships endpoint
    await request(app).post("/schemas/departments/relationships").set("Authorization", `Bearer ${adminToken}`).send({
        type: "O2O",
        target: "employees",
        foreignKey: "employeeId",
        name: "manager",
        alias: "department",
    });

    //Add permission for the test user role to create products with reviews.
    await request(app)
        .post("/permissions")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            role_Id: userRoleId,
            collection: "products",
            action: "create",
            fields: ["*", "reviews.*"],
        });
}

describe("Nested Relations - Create Operations", () => {
    test("Create with BelongsTo relation - nested create", async () => {
        const response = await request(app)
            .post("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "New Product",
                description: "Product Description",
                categories: {
                    name: "New Category",
                },
            });

        expect(response.status).toBe(201);
        expect(response.body.data).toBeDefined();

        // Verify the created data
        const productResponse = await request(app)
            .get(`/items/products/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "categories.*"] });

        expect(productResponse.body.data.categories.name).toBe("New Category");
    });

    test("Create with BelongsTo relation - existing reference", async () => {
        // First create a category
        const categoryResponse = await request(app)
            .post("/items/categories")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Existing Category" });

        const response = await request(app)
            .post("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Product with Existing Category",
                categories: {
                    id: categoryResponse.body.data.id,
                },
            });

        expect(response.status).toBe(201);

        const productResponse = await request(app)
            .get(`/items/products/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "categories.*"] });

        expect(productResponse.body.data.categories.name).toBe("Existing Category");
    });

    test("Create with HasMany relation", async () => {
        const response = await request(app)
            .post("/items/products")
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                name: "Product with Reviews",
                reviews: [
                    { content: "Great product", rating: 5 },
                    { content: "Average product", rating: 3 },
                ],
            });

        expect(response.status).toBe(201);

        const productResponse = await request(app)
            .get(`/items/products/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "reviews.*"] });

        console.log(productResponse.body.data);

        expect(productResponse.body.data.reviews).toHaveLength(2);
    });

    test("Create with BelongsToMany relation", async () => {
        const response = await request(app)
            .post("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Product with Tags",
                tags: [{ tags: { name: "New Tag 1" } }, { tags: { name: "New Tag 2" } }],
            });

        expect(response.status).toBe(201);

        const productResponse = await request(app)
            .get(`/items/products/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "tags.*"] });

        expect(productResponse.body.data.tags).toHaveLength(2);
    });
    /*
    test("Create with circular dependency", async () => {
        const response = await request(app)
            .post("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Engineering",
                manager: {
                    name: "John Doe",
                    email: "john@example.com",
                },
            });

        expect(response.status).toBe(201);

        const deptResponse = await request(app)
            .get(`/items/departments/${response.body.data?.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "manager.*"] });

        expect(deptResponse.body.data.manager.name).toBe("John Doe");
    });
*/
});

describe("Nested Relations - Update Operations", () => {
    let productId;
    let categoryId;

    beforeAll(async () => {
        // Create initial data
        const categoryResponse = await request(app)
            .post("/items/categories")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Initial Category" });
        categoryId = categoryResponse.body.data?.id;

        const productResponse = await request(app)
            .post("/items/products")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Initial Product",
                categories: { id: categoryId },
                reviews: [{ content: "Initial review", rating: 4 }],
                tags: [{ tags: { name: "Initial tag" } }],
            });
        productId = productResponse.body.data?.id;
    });

    test("Update BelongsTo relation", async () => {
        const response = await request(app)
            .patch(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                categories: {
                    name: "Updated Category",
                },
            });

        expect(response.status).toBe(200);

        const productResponse = await request(app)
            .get(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "categories.*"] });

        expect(productResponse.body.data.categories.name).toBe("Updated Category");
    });

    test("Update HasMany relation", async () => {
        const response = await request(app)
            .patch(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                reviews: [
                    { content: "Updated review 1", rating: 5 },
                    { content: "New review", rating: 4 },
                ],
            });

        expect(response.status).toBe(200);

        const productResponse = await request(app)
            .get(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "reviews.*"] });

        expect(productResponse.body.data.reviews).toHaveLength(2);
        // Check both reviews exist without relying on order
        expect(productResponse.body.data.reviews.some(r => r.content === "Updated review 1")).toBeTruthy();
        expect(productResponse.body.data.reviews.some(r => r.content === "New review")).toBeTruthy();
    });

    test("Update BelongsToMany relation", async () => {
        const response = await request(app)
            .patch(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                tags: [{ tags: { name: "Updated Tag" } }, { tags: { name: "Another Tag" } }],
            });

        expect(response.status).toBe(200);

        const productResponse = await request(app)
            .get(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "tags.*", "tags.tags.name"] });

        console.log(JSON.stringify(productResponse.body.data));

        expect(productResponse.body.data.tags).toHaveLength(2);
        expect(productResponse.body.data.tags.some((tag) => tag?.tags?.name === "Updated Tag")).toBeTruthy();
    });

    test("Update with mixed relations", async () => {
        const response = await request(app)
            .patch(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Updated Product Name",
                categories: { name: "Mixed Update Category" },
                reviews: [{ content: "Mixed update review", rating: 5 }],
                tags: [{ tags: { name: "Mixed Tag" } }],
            });

        expect(response.status).toBe(200);

        const productResponse = await request(app)
            .get(`/items/products/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "categories.*", "reviews.*", "tags.tags.name"] });

        expect(productResponse.body.data.name).toBe("Updated Product Name");
        expect(productResponse.body.data.categories.name).toBe("Mixed Update Category");

        expect(
            productResponse.body.data.reviews.some((review) => review.content === "Mixed update review")
        ).toBeTruthy();

        expect(productResponse.body.data.tags.some((tag) => tag.tags.name === "Mixed Tag")).toBeTruthy();
    });
});

afterAll(async () => {
    // Clean up
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
