import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;

describe("Full-Text Search API Tests", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();

        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;

        // Create a test user
        const registerResponse = await request(app)
            .post("/auth/register")
            .send({ firstName: "Test", lastName: "User", email: "testuser@test.com", password: "testpassword" });
        testUserId = registerResponse.body.user.id;

        console.log("Test user ID:", registerResponse.body);

        // Login as test user
        const userLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "testuser@test.com", password: "testpassword" });
        userToken = userLoginResponse.body.token;

        // Create posts schema
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
                    },
                },
            });

        // Create test posts
        const posts = [
            {
                title: "First post about databases",
                content: "This is a post about SQL databases.",
                authorId: testUserId,
            },
            {
                title: "Second post about programming",
                content: "This is a post about JavaScript programming.",
                authorId: testUserId,
            },
            {
                title: "Third post about web development",
                content: "This post covers HTML, CSS, and JavaScript.",
                authorId: testUserId,
            },
            {
                title: "Fourth post about databases",
                content: "This post is about NoSQL databases.",
                authorId: testUserId,
            },
        ];

        for (const post of posts) {
            await request(app).post("/items/posts").set("Authorization", `Bearer ${adminToken}`).send(post);
        }

        //Create permissions for the test user to access the posts schema
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userLoginResponse.body.role.id,
            collection: "posts",
            action: "read",
            fields: "*",
        });
    });

    test("Basic search functionality", async () => {
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({ search: "databases", searchFields: ["title", "content"] });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data.some((post) => post.title.includes("First post"))).toBeTruthy();
        expect(response.body.data.some((post) => post.title.includes("Fourth post"))).toBeTruthy();
    });

    test("Search with relevance sorting", async () => {
        const response = await request(app)
            .get("/items/posts?search=databases&sortByRelevance=true")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data[0].title).toContain("First post");
    });

    test("Search with regular sorting", async () => {
        const response = await request(app)
            .get('/items/posts?search=databases&sort={"title":"desc"}')
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data[0].title).toContain("Fourth post");
    });

    test("Search with pagination", async () => {
        const response = await request(app)
            .get("/items/posts?search=post&limit=2&page=1")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.totalCount).toBe(4);
    });

    test("Search with field filtering", async () => {
        const response = await request(app)
            .get("/items/posts")
            .query({ fields: ["title", "content"], search: "JavaScript" })
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data.every((post) => "title" in post && "content" in post)).toBeTruthy();
        expect(response.body.data.every((post) => !("authorId" in post))).toBeTruthy();
    });

    test("Search with additional filters", async () => {
        const response = await request(app)
            .get("/items/posts")
            .set("Authorization", `Bearer ${userToken}`)
            .query({ search: "databases", filter: JSON.stringify({ "title": { iLike: "First" } }) });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].title).toContain("First post");
    });

    test("Search with no results", async () => {
        const response = await request(app)
            .get("/items/posts?search=nonexistent")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(0);
    });

    test("Search with partial word match", async () => {
        const response = await request(app)
            .get("/items/posts?search=program")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].title).toContain("Second post");
    });

    test("Case-insensitive search", async () => {
        const response = await request(app)
            .get("/items/posts?search=DATABASE")
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
    });
});

afterAll(async () => {
    // Clean up: delete the posts schema
    //await request(app).delete("/schemas/posts").set("Authorization", `Bearer ${adminToken}`);
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
