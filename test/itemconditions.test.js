import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";

let app;
let adminToken;
let adminUserId;
let userToken;
let testUserId;
let userRoleId;
let userPermissionIds = [];

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;
    adminUserId = adminLoginResponse.body.user.id;

    // Create a test user
    const createUserResponse = await request(app).post("/auth/register").send({
        firstName: "Test",
        lastName: "User",
        email: "testuser@test.com",
        password: "userpassword",
    });

    testUserId = createUserResponse.body.user.id;
    userRoleId = createUserResponse.body.role.id;

    // Login as test user
    const userLoginResponse = await request(app).post("/auth/login").send({
        email: "testuser@test.com",
        password: "userpassword",
    });
    userToken = userLoginResponse.body.token;

    // Create test permissions for the user role
    const permissions = [
        { role_Id: userRoleId, collection: "posts", action: "read", fields: ["*"] },
        {
            role_Id: userRoleId,
            collection: "posts",
            action: "create",
            fields: ["title", "content", "authorId", "published"],
        },
        {
            role_Id: userRoleId,
            collection: "posts",
            action: "update",
            fields: ["title", "content"],
            conditions: { authorId: { eq: "$CURRENT_USER.id" } }, // Changed from 'equals' to 'eq'
        },
        {
            role_Id: userRoleId,
            collection: "posts",
            action: "delete",
            conditions: { authorId: { eq: "$CURRENT_USER.id" }, published: { eq: false } }, // Changed from 'equals' to 'eq'
        },
    ];

    for (const permission of permissions) {
        const resp = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(permission);
        userPermissionIds.push(resp.body.id);
    }

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
                    title: { type: "String", required: true },
                    content: { type: "String", required: true },
                    published: { type: "Boolean", defaultValue: { value: false } },
                    authorId: { type: "String", required: true },
                    createdAt: { type: "DateTime", default: "NOW" },
                },
            },
        });
});

describe("Item Routes with Conditions", () => {
    let userPostId, adminPostId;

    test("Create a post as test user", async () => {
        const response = await request(app).post("/items/posts").set("Authorization", `Bearer ${userToken}`).send({
            title: "Test User Post",
            content: "This is a test post by the test user",
            authorId: testUserId,
            published: false,
        });

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveProperty("id");
        userPostId = response.body.data.id;
    });

    test("Create a post as admin", async () => {
        const response = await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
            title: "Admin Post",
            content: "This is a test post by the admin",
            authorId: adminUserId,
            published: true,
        });

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveProperty("id");
        adminPostId = response.body.data.id;
    });

    test("Update own post (should succeed)", async () => {
        const response = await request(app)
            .patch(`/items/posts/${userPostId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                title: "Updated User Post",
                content: "This post has been updated by the test user",
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveProperty("id", userPostId);
    });

    test("Update admin's post (should fail)", async () => {
        const response = await request(app)
            .patch(`/items/posts/${adminPostId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                title: "Attempt to Update Admin Post",
                content: "This should not work",
            });

        console.log("4", response.body);

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Delete own unpublished post (should succeed)", async () => {
        const response = await request(app)
            .delete(`/items/posts/${userPostId}`)
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
    });

    test("Delete admin's published post (should fail)", async () => {
        const response = await request(app)
            .delete(`/items/posts/${adminPostId}`)
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
    });

    test("Create a new post and try to publish it (should fail)", async () => {
        const createResponse = await request(app)
            .post("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                title: "Another Test User Post",
                content: "This is another test post by the test user",
                authorId: testUserId,
            });

        expect(createResponse.status).toBe(201);
        const newPostId = createResponse.body.data.id;

        const updateResponse = await request(app)
            .patch(`/items/posts/${newPostId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                published: true,
            });

        expect(updateResponse.status).toBe(403);
        expect(updateResponse.body).toHaveProperty("error");
    });

    test("Delete with isNotNull condition and specific id should only delete that id", async () => {
        // Set up permission with isNotNull condition AND fields explicitly defined
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read", // Add read permission first
                fields: ["*"], // Explicitly define fields as array
            });

        const deletePermission = await request(app)
            .patch("/permissions/" + userPermissionIds[3])
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "delete",
                fields: ["*"], // Explicitly define fields as array
                conditions: {
                    AND: [
                        {
                            id: {
                                isNotNull: true,
                            },
                        },
                    ],
                },
            });

        console.log("deletePermission", deletePermission.body);

        // Add create permission too
        const createPermission = await request(app)
            .patch("/permissions/" + userPermissionIds[1])
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "create",
                fields: ["*", "title", "content", "authorId", "published"],
            });

        // Create multiple test posts
        const posts = [
            {
                title: "Post 1",
                content: "Content 1",
                authorId: testUserId,
                published: false,
            },
            {
                title: "Post 2",
                content: "Content 2",
                authorId: testUserId,
                published: false,
            },
        ];

        // Create the posts and store their IDs
        const createdPosts = [];
        for (const post of posts) {
            const response = await request(app)
                .post("/items/posts")
                .set("Authorization", `Bearer ${userToken}`)
                .send(post);

            expect(response.status).toBe(201);
            createdPosts.push(response.body.data.id);
        }

        // Try to delete only the first post
        const deleteResponse = await request(app)
            .delete(`/items/posts/${createdPosts[0]}`)
            .set("Authorization", `Bearer ${userToken}`);

        // Verify delete was successful
        expect(deleteResponse.status).toBe(200);

        // Verify only the specified post was deleted
        const remainingPosts = await request(app).get("/items/posts").set("Authorization", `Bearer ${userToken}`);

        expect(remainingPosts.body.data.length).toBe(3);
        expect(remainingPosts.body.data[2].id).toBe(createdPosts[1]);

        // Clean up permissions
        await request(app).delete(`/permissions/${newPermission.body.id}`).set("Authorization", `Bearer ${adminToken}`);
        await request(app)
            .delete(`/permissions/${deletePermission.body.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
        await request(app)
            .delete(`/permissions/${createPermission.body.id}`)
            .set("Authorization", `Bearer ${adminToken}`);
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
