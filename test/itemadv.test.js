import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";

let app;
let adminToken;
let userToken;
let user_Id;
let userRoleId;
let userPermissions = [];

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Set up admin token
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create a test user
    const createUserResponse = await request(app).post("/auth/register").send({
        firstName: "Test",
        lastName: "User",
        email: "testuser@test.com",
        password: "userpassword",
    });

    user_Id = createUserResponse.body.user.id;
    userRoleId = createUserResponse.body.role.id;

    // Login as test user
    const userLoginResponse = await request(app).post("/auth/login").send({
        email: "testuser@test.com",
        password: "userpassword",
    });
    userToken = userLoginResponse.body.token;

    // Create permissions for the test user role
    const permissions = [
        {
            role_Id: userRoleId,
            collection: "Category",
            action: "read",
            fields: "*",
        },

        {
            role_Id: userRoleId,
            collection: "Review",
            action: "read",
            fields: "id,text,rating,product.id,product.name,author.id,author.firstName",
        },
    ];

    for (const permission of permissions) {
        let resp = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(permission);
        userPermissions.push(resp.body);
    }

    // Create schemas
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "Category",
            schema: {
                name: "Category",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                },
            },
        });

    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "Product",
            schema: {
                name: "Product",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    description: { type: "String", allowNull: false },
                    price: { type: "Double", allowNull: false },
                    categoryId: {
                        type: "UUID",
                        relType: "BelongsTo",
                        target: "Category",
                        foreignKey: "categoryId",
                        as: "category",
                    },
                    createdAt: { type: "Date", defaultValue: { type: "NOW" } },
                    updatedAt: { type: "Date", defaultValue: { type: "NOW" } },
                },
            },
        });

    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "Review",
            schema: {
                name: "Review",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    text: { type: "String", allowNull: false },
                    rating: { type: "Integer", allowNull: false },
                    authorId: {
                        type: "UUID",
                        relType: "BelongsTo",
                        target: "baasix_User",
                        foreignKey: "authorId",
                        as: "author",
                    },
                    productId: {
                        type: "UUID",
                        relType: "BelongsTo",
                        target: "Product",
                        foreignKey: "productId",
                        as: "product",
                    },
                },
            },
        });

    //Add Review relational field to Product schema
    await request(app)
        .patch("/schemas/Product")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "Product",
            schema: {
                name: "Product",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    description: { type: "String", allowNull: false },
                    price: { type: "Double", allowNull: false },
                    categoryId: {
                        type: "UUID",
                        relType: "BelongsTo",
                        target: "Category",
                        foreignKey: "categoryId",
                        as: "category",
                    },
                    Reviews: {
                        relType: "HasMany",
                        target: "Review",
                        foreignKey: "productId",
                        as: "Review",
                    },
                    createdAt: { type: "Date", defaultValue: { type: "NOW" } },
                    updatedAt: { type: "Date", defaultValue: { type: "NOW" } },
                },
            },
        });

    // Create test data
    const categoryResponse = await request(app)
        .post("/items/Category")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Electronics" });
    const categoryId = categoryResponse.body.data.id;

    const productResponse = await request(app)
        .post("/items/Product")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Smartphone",
            description: "Latest model",
            price: 999.99,
            categoryId: categoryId,
        });
    const productId = productResponse.body.data.id;

    await request(app).post("/items/Review").set("Authorization", `Bearer ${adminToken}`).send({
        text: "Great product!",
        rating: 5,
        productId: productId,
        authorId: user_Id,
    });
});

describe("Advanced Field Permissions", () => {
    test("Simple field permission: field1.name", async () => {
        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "name,category.*",
        });

        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "category.name"],
            });

        console.log("response", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0].category).toHaveProperty("name");
        expect(response.body.data[0]).not.toHaveProperty("description");
        expect(response.body.data[0]).not.toHaveProperty("price");

        console.log("createdPerm.body", createdPerm.body);

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });

    test("Nested field permission: field1.user.name", async () => {
        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "Review,name,Review.author.*",
        });

        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["Review.*", "name", "Review.author.firstName"],
            });

        console.log("response", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0].Review[0].author).toHaveProperty("firstName");
        expect(response.body.data[0].Review[0].author).not.toHaveProperty("email");

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });

    test("Wildcard field permission: field.*", async () => {
        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "name,category.*",
        });

        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "category.*"],
            });

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0].category).toHaveProperty("name");
        expect(response.body.data[0].category).toHaveProperty("id");
        expect(response.body.data[0]).not.toHaveProperty("description");

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });

    test("Nested wildcard field permission: field.*.*", async () => {
        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "name,Review.*.*",
        });

        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "Review.id", "Review.*.*"],
            });

        console.log("response", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0].Review[0]).toHaveProperty("text");
        expect(response.body.data[0].Review[0]).toHaveProperty("rating");
        expect(response.body.data[0].Review[0].author).toHaveProperty("firstName");
        expect(response.body.data[0].Review[0].author).toHaveProperty("email");

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });

    test("Full wildcard permission: *", async () => {
        console.log("Full wildcard permission start");

        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "*,category.*,Review.id",
        });

        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["*", "category.*", "Review.id"],
            });

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0]).toHaveProperty("description");
        expect(response.body.data[0]).toHaveProperty("price");
        expect(response.body.data[0]).toHaveProperty("category");
        expect(response.body.data[0]).toHaveProperty("Review");

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });

    test("Nested double wildcard permission: field.**", async () => {
        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "name,Review.*.*",
        });

        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "Review.*.*"],
            });

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0].Review[0]).toHaveProperty("text");
        expect(response.body.data[0].Review[0]).toHaveProperty("rating");
        expect(response.body.data[0].Review[0].author).toHaveProperty("firstName");
        expect(response.body.data[0].Review[0].author).toHaveProperty("email");

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });

    test("Mixed permissions", async () => {
        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "name,description,category.name,Review.*, Review.author.firstName",
        });

        const response2 = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "description", "category.name", "Review.*", "Review.author.firstName"],
            });

        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "description", "category.name", "Review.*", "Review.author.firstName"],
            });

        expect(response.status).toBe(200);
        expect(response.body.data[0]).toHaveProperty("name");
        expect(response.body.data[0]).toHaveProperty("description");
        expect(response.body.data[0]).not.toHaveProperty("price");
        expect(response.body.data[0].category).toHaveProperty("name");
        expect(response.body.data[0].Review[0]).toHaveProperty("text");
        expect(response.body.data[0].Review[0]).toHaveProperty("rating");
        expect(response.body.data[0].Review[0].author).toHaveProperty("firstName");
        expect(response.body.data[0].Review[0].author).not.toHaveProperty("email");

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });

    test("Sorting with relational fields", async () => {
        // Create additional test data for sorting
        const category2Response = await request(app)
            .post("/items/Category")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Books" });
        const category2Id = category2Response.body.data.id;

        const product2Response = await request(app)
            .post("/items/Product")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Novel",
                description: "Bestseller",
                price: 15.99,
                categoryId: category2Id,
            });

        // Create permission for sorting with relational fields
        const createdPerm = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "Product",
            action: "read",
            fields: "name,description,price,category.*",
        });

        // Test sorting by relational field (category.name)
        const response = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "description", "price", "category.name"],
                sort: JSON.stringify({ "category.name": "ASC" })
            });

        console.log("Sorting response", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
        
        // Verify sorting - "Books" should come before "Electronics" alphabetically
        expect(response.body.data[0].category.name).toBe("Books");
        expect(response.body.data[0].name).toBe("Novel");
        expect(response.body.data[1].category.name).toBe("Electronics");
        expect(response.body.data[1].name).toBe("Smartphone");

        // Test descending sort
        const descResponse = await request(app)
            .get("/items/Product")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["name", "category.name"],
                sort: JSON.stringify({ "category.name": "DESC" })
            });

        expect(descResponse.status).toBe(200);
        expect(descResponse.body.data[0].category.name).toBe("Electronics");
        expect(descResponse.body.data[1].category.name).toBe("Books");

        //Delete the permission after the test
        await request(app).delete(`/permissions/${createdPerm.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
