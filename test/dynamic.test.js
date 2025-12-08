import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe, beforeEach, afterAll } from "@jest/globals";

let app;
let adminToken;
let adminUserId;
let userToken;
let testUserId;
let userRoleId;
let permissionId;

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

    // Create a test user role
    const userRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "testuser", description: "Test user role" });
    userRoleId = userRoleResponse.body.data.id;

    // Create a test user
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
                    authorId: { type: "String", allowNull: false },
                    status: { type: "String", allowNull: false },
                    createdAt: { type: "DateTime", default: "NOW" },
                },
            },
        });

    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "comments",
            schema: {
                name: "Comment",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    content: { type: "String", allowNull: false },
                    authorId: { type: "UUID", allowNull: false },
                    postId: {
                        type: "Integer",
                        relType: "BelongsTo",
                        target: "posts",
                        foreignKey: "postId",
                        as: "post",
                    },
                    author: {
                        relType: "BelongsTo",
                        target: "baasix_User",
                        foreignKey: "authorId",
                        as: "author",
                    },
                },
            },
        });

    //Update the posts schema to add the relation
    await request(app)
        .patch("/schemas/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "posts",
            schema: {
                name: "Post",
                fields: {
                    id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                    title: { type: "String", allowNull: false },
                    content: { type: "String", allowNull: false },
                    authorId: { type: "String", allowNull: false },
                    status: { type: "String", allowNull: false },
                    createdAt: { type: "DateTime", default: "NOW" },
                    comments: {
                        relType: "HasMany",
                        target: "comments",
                        foreignKey: "postId",
                        as: "comments",
                    },
                },
            },
        });

    // Create some test posts
    await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
        title: "Admin Post",
        content: "This is an admin post",
        authorId: adminUserId,
        status: "published",
    });

    await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
        title: "User Post",
        content: "This is a user post",
        authorId: testUserId,
        status: "draft",
    });
});

describe("Dynamic Variables in Filters Tests", () => {
    beforeEach(async () => {
        // Reset permissions before each test
        if (permissionId) {
            await request(app).delete(`/permissions/${permissionId}`).set("Authorization", `Bearer ${adminToken}`);
            permissionId = null;
        }
        // Reload permissions cache
        await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);
    });
    
    test("Permission condition with dynamic variable", async () => {
        // Set up permission with dynamic variable in condition
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*",
                conditions: { authorId: { eq: "$CURRENT_USER.id" } },
            });

        permissionId = newPermission.body.id;

        // User should only see their own post
        const response = await request(app).get("/items/posts").set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toHaveProperty("authorId", testUserId);
    });

    test("User-provided filter with dynamic variable", async () => {
        // Set up permission without conditions
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*",
            });

        permissionId = newPermission.body.id;

        // User applies a filter with a dynamic variable
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({ filter: { authorId: { eq: "$CURRENT_USER.id" } } });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toHaveProperty("authorId", testUserId);
    });

    test("Combination of permission condition and user filter", async () => {
        // Set up permission with condition
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*",
                conditions: { status: { eq: "draft" } },
            });

        permissionId = newPermission.body.id;

        // User applies an additional filter
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({ filter: { authorId: { eq: "$CURRENT_USER.id" } } });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toHaveProperty("authorId", testUserId);
        expect(response.body.data[0]).toHaveProperty("status", "draft");
    });

    test("Dynamic variable in nested filter", async () => {
        // Create posts with nested data
        const postResponse = await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
            title: "Post with Comments",
            content: "This post has comments",
            authorId: testUserId,
            status: "published",
        });

        await request(app).post("/items/comments").set("Authorization", `Bearer ${adminToken}`).send({
            content: "User comment",
            authorId: testUserId,
            postId: postResponse.body.data.id,
        });

        // Set up permission
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*, comments.*.*.*",
            });

        permissionId = newPermission.body.id;

        // User applies a nested filter with a dynamic variable
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["*", "comments.*.*.*"],
                filter: JSON.stringify({
                    "comments.authorId": { eq: "$CURRENT_USER.id" },
                }),
            });

        console.log(JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toHaveProperty("title", "Post with Comments");
    });

    test("Dynamic variable in permission relational condition", async () => {
        // Set up permission with relational condition
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*",
                conditions: {
                    "comments.authorId": { eq: "$CURRENT_USER.id" },
                },
            });

        permissionId = newPermission.body.id;

        // User should only see posts where they have commented
        const response = await request(app).get("/items/posts").set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toHaveProperty("title", "Post with Comments");
    });

    // Add these test cases to your dynamic.test.js file

    test("AND logical operator with dynamic variable", async () => {
        // Set up permission with AND condition
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*",
                conditions: {
                    AND: [{ authorId: { eq: "$CURRENT_USER.id" } }, { status: { eq: "published" } }],
                },
            });

        permissionId = newPermission.body.id;

        // Test the AND condition
        const response = await request(app).get("/items/posts").set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].title).toBe("Post with Comments");
    });

    test("OR logical operator with dynamic variable", async () => {
        // Set up permission with OR condition
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*",
                conditions: {
                    OR: [{ authorId: { eq: "$CURRENT_USER.id" } }, { status: { eq: "published" } }],
                },
            });

        permissionId = newPermission.body.id;

        // Create test posts
        await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
            title: "Another User's Published Post",
            content: "This is a published post by another user",
            authorId: testUserId,
            status: "published",
        });

        // Create test posts
        await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
            title: "Another User's Published Post",
            content: "Missing Post",
            authorId: adminUserId,
            status: "draft",
        });

        // Test the OR condition
        const response = await request(app).get("/items/posts").set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(4);
        expect(response.body.data.some((post) => post.title === "User Post")).toBe(true);
        expect(response.body.data.some((post) => post.title === "Post with Comments")).toBe(true);
        expect(response.body.data.some((post) => post.title === "Another User's Published Post")).toBe(true);
    });

    //Nested OR and AND conditions with dynamic variables
    test("Nested OR and AND conditions with dynamic variables", async () => {
        // Set up permission with nested OR and AND conditions
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*",
                conditions: {
                    AND: [
                        { authorId: { ne: "$CURRENT_USER.id" } },
                        {
                            AND: [{ status: { eq: "published" } }, { authorId: { eq: adminUserId } }],
                        },
                    ],
                },
            });

        permissionId = newPermission.body.id;

        // Test the nested OR and AND conditions
        const response = await request(app).get("/items/posts").set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data.some((post) => post.title === "Admin Post")).toBe(true);
    });

    test("Filter HasMany relationship with IN operator and dynamic variable", async () => {
        // Set up permission with HasMany relationship
        const permissionResponse = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*,comments.*",
            });

        // Create some test comments with different author IDs
        const authorIds = [testUserId, adminUserId];
        const posts = [
            {
                title: "Post with Multiple Comments",
                content: "This is a test post",
                authorId: adminUserId,
                status: "published",
            },
            {
                title: "Another Post",
                content: "Another test post",
                authorId: adminUserId,
                status: "published",
            },
        ];

        // Create posts and their comments
        for (const post of posts) {
            const postResponse = await request(app)
                .post("/items/posts")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(post);

            // Create comments for each post from different authors
            for (const authorId of authorIds) {
                await request(app)
                    .post("/items/comments")
                    .set("Authorization", `Bearer ${adminToken}`)
                    .send({
                        content: `Comment from author ${authorId}`,
                        authorId: authorId,
                        postId: postResponse.body.data.id,
                    });
            }
        }

        // Test filtering posts where comments' authorIds include the current user's ID
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["*", "comments.*"],
                filter: JSON.stringify({
                    "comments.authorId": {
                        in: ["$CURRENT_USER.id"],
                    },
                }),
            });

        console.log("HasMany filter response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(3); // Should return both posts since they both have comments from the test user

        // Verify that each post has at least one comment from the test user
        response.body.data.forEach((post) => {
            const hasUserComment = post.comments.some((comment) => comment.authorId === testUserId);
            expect(hasUserComment).toBe(true);
        });
    });

    test("Update with HasMany relationship filter using dynamic variable", async () => {
        // Set up update permission with HasMany relationship and dynamic variable condition
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "update",
                fields: "*",
                conditions: {
                    "comments.authorId": {
                        in: ["$CURRENT_USER.id"],
                    },
                },
            });

        console.log("Permission created:", newPermission.body);

        // Create test posts with comments
        const postsData = [
            {
                title: "Post 1 for Update Test",
                content: "Content 1",
                authorId: adminUserId,
                status: "published",
            },
            {
                title: "Post 2 for Update Test",
                content: "Content 2",
                authorId: adminUserId,
                status: "published",
            },
        ];

        const createdPosts = [];
        for (const postData of postsData) {
            const postResponse = await request(app)
                .post("/items/posts")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(postData);

            createdPosts.push(postResponse.body.data);

            // Add comments from both test user and admin
            await request(app).post("/items/comments").set("Authorization", `Bearer ${adminToken}`).send({
                content: "Admin comment",
                authorId: adminUserId,
                postId: postResponse.body.data.id,
            });

            // Only add test user comment to first post
            if (createdPosts.length === 1) {
                await request(app).post("/items/comments").set("Authorization", `Bearer ${adminToken}`).send({
                    content: "Test user comment",
                    authorId: testUserId,
                    postId: postResponse.body.data.id,
                });
            }
        }

        // Try to update both posts as test user
        const updateData = { content: "Updated content" };

        // Should succeed for first post (has test user comment)
        const response1 = await request(app)
            .patch(`/items/posts/${createdPosts[0].id}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send(updateData);

        console.log("Update response 1:", response1.body);
        expect(response1.status).toBe(200);

        // Should fail for second post (no test user comment)
        const response2 = await request(app)
            .patch(`/items/posts/${createdPosts[1].id}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send(updateData);

        console.log("Update response 2:", response2.body);
        expect(response2.status).toBe(403);

        // Verify the updates
        const finalPost1 = await request(app)
            .get(`/items/posts/${createdPosts[0].id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const finalPost2 = await request(app)
            .get(`/items/posts/${createdPosts[1].id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(finalPost1.body.data.content).toBe("Updated content");
        expect(finalPost2.body.data.content).toBe("Content 2");
    });

    test("Delete with HasMany relationship filter using dynamic variable", async () => {
        // Set up delete permission with HasMany relationship and dynamic variable condition
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "delete",
                fields: "*",
                conditions: {
                    "comments.authorId": {
                        in: ["$CURRENT_USER.id"],
                    },
                },
            });

        console.log("Permission created:", newPermission.body);

        // Create test posts with comments
        const postsData = [
            {
                title: "Post 1 for Delete Test",
                content: "Content 1",
                authorId: adminUserId,
                status: "published",
            },
            {
                title: "Post 2 for Delete Test",
                content: "Content 2",
                authorId: adminUserId,
                status: "published",
            },
        ];

        const createdPosts = [];
        for (const postData of postsData) {
            const postResponse = await request(app)
                .post("/items/posts")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(postData);

            createdPosts.push(postResponse.body.data);

            // Add comments from both test user and admin
            await request(app).post("/items/comments").set("Authorization", `Bearer ${adminToken}`).send({
                content: "Admin comment",
                authorId: adminUserId,
                postId: postResponse.body.data.id,
            });

            // Only add test user comment to first post
            if (createdPosts.length === 1) {
                await request(app).post("/items/comments").set("Authorization", `Bearer ${adminToken}`).send({
                    content: "Test user comment",
                    authorId: testUserId,
                    postId: postResponse.body.data.id,
                });
            }
        }

        // Try to delete both posts as test user
        // Should succeed for first post (has test user comment)
        const response1 = await request(app)
            .delete(`/items/posts/${createdPosts[0].id}`)
            .set("Authorization", `Bearer ${userToken}`);

        console.log("Delete response 1:", response1.body);
        expect(response1.status).toBe(200);

        // Should fail for second post (no test user comment)
        const response2 = await request(app)
            .delete(`/items/posts/${createdPosts[1].id}`)
            .set("Authorization", `Bearer ${userToken}`);

        console.log("Delete response 2:", response2.body);
        expect(response2.status).toBe(403);

        // Verify the deletes
        const finalPost1 = await request(app)
            .get(`/items/posts/${createdPosts[0].id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const finalPost2 = await request(app)
            .get(`/items/posts/${createdPosts[1].id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(finalPost1.status).toBe(403);
        expect(finalPost2.status).toBe(200);
    });

    //Test to retrieve single post with multiple comments from the test user and match comments count. Create a new post with multiple comments from the test user and verify the count.
    test("Retrieve single post with multiple comments from the test user and match comments count", async () => {
        // Set up permission with HasMany relationship
        const permissionResponse = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "posts",
                action: "read",
                fields: "*,comments.*.*",
                conditions: {
                    "comments.authorId": {
                        in: ["$CURRENT_USER.id"],
                    },
                },
                relConditions: {
                    comments: {
                        content: {
                            startsWith: "Test user comment 1",
                        },
                    },
                },
            });

        // Create a post with multiple comments from the test user
        const postResponse = await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send({
            title: "Post with Multiple Comments",
            content: "This is a test post",
            authorId: adminUserId,
            status: "published",
        });

        // Create comments from the test user
        const commentsData = [
            { content: "Test user comment 1", authorId: testUserId, postId: postResponse.body.data.id },
            { content: "Test user comment 2", authorId: adminUserId, postId: postResponse.body.data.id },
            { content: "Test user comment 2", authorId: adminUserId },
        ];

        for (const commentData of commentsData) {
            await request(app).post("/items/comments").set("Authorization", `Bearer ${adminToken}`).send(commentData);
        }

        // Retrieve the post and comments
        const response = await request(app)
            .get(`/items/posts/${postResponse.body.data.id}`)
            .set("Authorization", `Bearer ${userToken}`)
            .query({
                fields: ["*", "comments.*"],
                relConditions: JSON.stringify({
                    comments: {
                        authorId: {
                            in: ["$CURRENT_USER.id"],
                        },
                    },
                }),
            });

        console.log("Single post with comments response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveProperty("comments");
        expect(response.body.data.comments.length).toBe(1);
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
