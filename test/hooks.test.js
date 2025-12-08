// File: test/postsHooksAdmin.test.js

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
let app;

describe("Posts Hooks Admin API Integration", () => {
    let adminToken;
    let testPostId;

    beforeAll(async () => {
        await destroyAllTablesInDB();

        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;

        // Create posts schema
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "posts2",
                schema: {
                    name: "Post",
                    fields: {
                        id: { type: "Integer", primaryKey: true, defaultValue: { type: "AUTOINCREMENT" } },
                        title: { type: "String", allowNull: false },
                        content: { type: "String", allowNull: false },
                        published: { type: "Boolean", default: false },
                        created_by: { type: "String" },
                        created_at: { type: "DateTime" },
                        updated_by: { type: "String" },
                        updated_at: { type: "DateTime" },
                        archived: { type: "Boolean", default: false },
                        archived_by: { type: "String" },
                        archived_at: { type: "DateTime" },
                    },
                },
            });
    });

    test("create hook adds created_by and created_at", async () => {
        const response = await request(app)
            .post("/items/posts2")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Test Post", content: "This is a test" });

        expect(response.status).toBe(201);
        testPostId = response.body.data.id;

        console.log("testPostId 1", testPostId);

        const getResponse = await request(app)
            .get(`/items/posts2/${testPostId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);

        console.log("getResponse.body", getResponse.body);

        expect(getResponse.body.data).toMatchObject({
            title: "Test Post",
            content: "This is a test",
            created_by: expect.any(String),
            created_at: expect.any(String),
        });
    });

    test("read hook returns all posts for admin", async () => {
        // Create published and unpublished posts
        await request(app)
            .post("/items/posts2")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Published Post", content: "Content 1", published: true });

        await request(app)
            .post("/items/posts2")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Unpublished Post", content: "Content 2", published: false });

        const response = await request(app).get("/items/posts2").set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.filter((post) => post.title === "Published Post")).toHaveLength(1);
        expect(response.body.data.filter((post) => post.title === "Unpublished Post")).toHaveLength(1);
    });

    test("update hook adds updated_by and updated_at", async () => {
        console.log("testPostId 2", testPostId);

        const updateResponse = await request(app)
            .patch(`/items/posts2/${testPostId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Updated Post" });

        expect(updateResponse.status).toBe(200);

        const getResponse = await request(app)
            .get(`/items/posts2/${testPostId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data).toMatchObject({
            title: "Updated Post",
            updated_by: expect.any(String),
            updated_at: expect.any(String),
        });
    });

    test("delete hook archives post instead of deleting", async () => {
        const createResponse = await request(app)
            .post("/items/posts2")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ title: "Post to Delete", content: "Content to delete" });

        const postToDeleteId = createResponse.body.data.id;

        const deleteResponse = await request(app)
            .delete(`/items/posts2/${postToDeleteId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        // The delete operation should be prevented
        expect(deleteResponse.status).toBe(500);

        const getResponse = await request(app)
            .get(`/items/posts2/${postToDeleteId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.data).toMatchObject({
            title: "Post to Delete",
            archived: true,
            archived_by: expect.any(String),
            archived_at: expect.any(String),
        });
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
