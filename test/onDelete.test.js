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
});

describe("SchemaManager onDelete API Tests", () => {
    let authorId;
    let postId;

    beforeAll(async () => {
        // Create test schemas
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "authors",
                schema: {
                    name: "Author",
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
                collectionName: "posts",
                schema: {
                    name: "Post",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: false },
                        authorId: {
                            type: "UUID",
                            relType: "BelongsTo",
                            target: "authors",
                            foreignKey: "authorId",
                            as: "author",
                            onDelete: "CASCADE",
                        },
                    },
                },
            });

        // Create a test author
        const authorResponse = await request(app)
            .post("/items/authors")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Test Author" });
        authorId = authorResponse.body.data.id;

        // Create a test post
        const postResponse = await request(app)
            .post("/items/posts")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Test Post", authorId: authorId });
        postId = postResponse.body.data.id;
    });

    test("onDelete CASCADE: Deleting author should delete associated post", async () => {
        // Delete the author
        await request(app).delete(`/items/authors/${authorId}`).set("Authorization", `Bearer ${adminToken}`);

        // Try to fetch the post
        const postResponse = await request(app)
            .get(`/items/posts/${postId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(postResponse.status).toBe(403); // 403 because the item is not found or user doesn't have permission
    });

    test("onDelete SET NULL: Post should have null authorId when author is deleted", async () => {
        // Update the schema to use SET NULL
        await request(app)
            .patch("/schemas/posts")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "posts",
                schema: {
                    name: "Post",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: false },
                        authorId: {
                            type: "UUID",
                            relType: "BelongsTo",
                            target: "authors",
                            foreignKey: "authorId",
                            as: "author",
                            onDelete: "SET NULL",
                        },
                    },
                },
            });

        // Create a new author and post
        const newAuthorResponse = await request(app)
            .post("/items/authors")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "New Test Author" });
        const newAuthorId = newAuthorResponse.body.data.id;

        const newPostResponse = await request(app)
            .post("/items/posts")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "New Test Post", authorId: newAuthorId });
        const newPostId = newPostResponse.body.data.id;

        // Delete the author
        await request(app).delete(`/items/authors/${newAuthorId}`).set("Authorization", `Bearer ${adminToken}`);

        // Fetch the post
        const postResponse = await request(app)
            .get(`/items/posts/${newPostId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(postResponse.status).toBe(200);
        expect(postResponse.body.data.authorId).toBeNull();
    });

    afterAll(async () => {
        // Clean up: delete the test schemas
        await request(app).delete("/schemas/posts").set("Authorization", `Bearer ${adminToken}`);
        await request(app).delete("/schemas/authors").set("Authorization", `Bearer ${adminToken}`);
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
