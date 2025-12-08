import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { filters } from "liquidjs";

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

    //Check the test user already exists
    const checkUserResponse = await request(app).get("/items/baasix_User").set("Authorization", `Bearer ${adminToken}`);

    if (checkUserResponse.body.data.length > 0) {
        //Find the test user
        const testUser = checkUserResponse.body.data.find((user) => user.email === "testuser@test.com");

        if (testUser) {
            testUserId = testUser.id;
        } else {
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

            // Create test permissions for the user role
            const permissions = [
                { role_Id: userRoleId, collection: "posts", action: "read", fields: ["*"] },
                { role_Id: userRoleId, collection: "posts", action: "create", fields: ["title", "content"] },
                { role_Id: userRoleId, collection: "baasix_User", action: "read", fields: ["*"] },
            ];

            console.log("adminToken:", adminToken);

            for (const permission of permissions) {
                let result = await request(app)
                    .post("/permissions")
                    .set("Authorization", `Bearer ${adminToken}`)
                    .send(permission);
                console.log("permissions result:", result.body);
            }
        }
    }

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
                    published: { type: "Boolean", default: false },
                    authorId: { type: "String", allowNull: false },
                    createdAt: { type: "DateTime", default: "now()" },
                },
                usertrack: true,
                paranoid: true,
            },
        });
});

describe("Item Routes", () => {
    let postId;

    //Test to get role name through the user table with admin permissions using relational query
    test("Get role name through the user table with admin permissions using relational query", async () => {
        const response = await request(app)
            .get("/items/baasix_User")
            .query({
                fields: ["*", "userRoles.role.name"],
                filter: JSON.stringify({
                    AND: [
                        {
                            "userRoles.role.name": {
                                eq: "user",
                            },
                            firstName: {
                                eq: "Test",
                            },
                        },
                    ],
                }),
                limit: 10,
                page: 1,
            })
            .set("Authorization", `Bearer ${adminToken}`);

        console.log("response.body:", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
        expect(response.body.data[0].userRoles[0]).toHaveProperty("role");
        expect(response.body.data[0].userRoles[0].role).toHaveProperty("name");
        expect(response.body.totalCount).toBe(1);
    });

    test("Create a post with admin permissions", async () => {
        const response = await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
            title: "Test Post",
            content: "This is a test post",
            authorId: testUserId,
            published: true,
        });

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveProperty("id");
        postId = response.body.data.id;
    });

    test("Get posts with user permissions", async () => {
        const response = await request(app).get("/items/posts").set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
    });

    test("Update a post with limited user permissions (should fail)", async () => {
        const response = await request(app)
            .patch(`/items/posts/${postId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                title: "Updated Title",
                content: "Updated Content",
                published: true,
            });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error.message).toMatch(/don't have permission/);
    });

    test("Update a post with admin permissions", async () => {
        const response = await request(app)
            .patch(`/items/posts/${postId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                title: "Updated Title",
                content: "Updated Content",
                published: true,
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveProperty("id");
    });

    test("Delete a post with user permissions (should fail)", async () => {
        const response = await request(app)
            .delete(`/items/posts/${postId}`)
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(403);
    });

    test("Delete a post with admin permissions", async () => {
        const response = await request(app)
            .delete(`/items/posts/${postId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
    });
});

afterAll(async () => {
    // Clean up
    //await request(app).delete(`/items/baasix_User/${testUserId}`).set("Authorization", `Bearer ${adminToken}`);

    // await request(app).delete(`/items/baasix_Role/${userRoleId}`).set("Authorization", `Bearer ${adminToken}`);

    //await request(app).delete("/schemas/posts").set("Authorization", `Bearer ${adminToken}`);

    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
