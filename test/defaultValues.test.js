import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe, beforeEach } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;
let userRoleId;

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    // Create a test user
    const createUserResponse = await request(app).post("/auth/register").send({
        firstName: "Test",
        lastName: "User",
        email: "testuser@test.com",
        password: "userpassword",
    });

    testUserId = createUserResponse.body.user.id;
    userRoleId = createUserResponse.body.role.id;

    // Assign role to the test user
    await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
        user_Id: testUserId,
        role_Id: userRoleId,
    });

    // Login as test user
    const userLoginResponse = await request(app).post("/auth/login").send({
        email: "testuser@test.com",
        password: "userpassword",
    });
    userToken = userLoginResponse.body.token;

    // Create test schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "posts",
            schema: {
                name: "Post",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    title: { type: "String", allowNull: false },
                    content: { type: "String", allowNull: false },
                    status: { type: "String", allowNull: false },
                    authorId: { type: "String", allowNull: false },
                    createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                },
            },
        });
});

describe("Default Values Tests", () => {
    let permissionId;

    beforeEach(async () => {
        // Reset permissions before each test
        if (permissionId) {
            await request(app).delete(`/permissions/${permissionId}`).set("Authorization", `Bearer ${adminToken}`);
        }
        // Reload permissions cache
        await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);
    });

    test("Create with static default value", async () => {
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "create",
                fields: "*",
                defaultValues: { status: "draft" },
            });

        permissionId = newPermission.body.id;

        const response = await request(app).post("/items/posts").set("Authorization", `Bearer ${userToken}`).send({
            title: "Test Post",
            content: "This is a test post",
            authorId: testUserId,
        });

        expect(response.status).toBe(201);
        const createdPost = await request(app)
            .get(`/items/posts/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(createdPost.body.data).toHaveProperty("status", "draft");
    });

    test("Create with dynamic default value", async () => {
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "create",
                fields: "*",
                defaultValues: { authorId: "$CURRENT_USER.id" },
            });

        permissionId = newPermission.body.id;

        const response = await request(app).post("/items/posts").set("Authorization", `Bearer ${userToken}`).send({
            title: "Test Post",
            content: "This is a test post",
            status: "published",
        });

        expect(response.status).toBe(201);
        const createdPost = await request(app)
            .get(`/items/posts/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(createdPost.body.data).toHaveProperty("authorId", testUserId);
    });

    test("Update with static default value", async () => {
        // First, create a post
        const createResponse = await request(app)
            .post("/items/posts")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                title: "Test Post",
                content: "This is a test post",
                status: "draft",
                authorId: testUserId,
            });

        const postId = createResponse.body.data.id;

        // Set up update permission with default value
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "update",
                fields: "*",
                defaultValues: { status: "under_review" },
            });

        permissionId = newPermission.body.id;

        // Update the post
        const updateResponse = await request(app)
            .patch(`/items/posts/${postId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                title: "Updated Test Post",
            });

        expect(updateResponse.status).toBe(200);
        const updatedPost = await request(app)
            .get(`/items/posts/${postId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        console.log("updatedPost", updatedPost.body.data);

        expect(updatedPost.body.data).toHaveProperty("status", "under_review");
    });

    test("Default value should not override provided value", async () => {
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "create",
                fields: "*",
                defaultValues: { status: "draft" },
            });

        permissionId = newPermission.body.id;

        const response = await request(app).post("/items/posts").set("Authorization", `Bearer ${userToken}`).send({
            title: "Test Post",
            content: "This is a test post",
            status: "published",
            authorId: testUserId,
        });

        expect(response.status).toBe(201);
        const createdPost = await request(app)
            .get(`/items/posts/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(createdPost.body.data).toHaveProperty("status", "published");
    });

    test("Multiple default values", async () => {
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "create",
                fields: "*",
                defaultValues: { status: "draft", authorId: "$CURRENT_USER.id" },
            });

        permissionId = newPermission.body.id;

        const response = await request(app).post("/items/posts").set("Authorization", `Bearer ${userToken}`).send({
            title: "Test Post",
            content: "This is a test post",
        });

        expect(response.status).toBe(201);
        const createdPost = await request(app)
            .get(`/items/posts/${response.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(createdPost.body.data).toHaveProperty("status", "draft");
        expect(createdPost.body.data).toHaveProperty("authorId", testUserId);
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
