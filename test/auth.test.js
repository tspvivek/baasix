import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userRoleId;

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Login as admin to get the admin token
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;
});

let userToken;

describe("POST /auth/register", () => {
    it("should register a new user", async () => {
        const res = await request(app).post("/auth/register").send({
            firstName: "New",
            lastName: "User",
            email: "newuser@example.com",
            password: "password123",
        });

        userRoleId = res.body.role.id;

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("user");
        expect(res.body.user.email).toBe("newuser@example.com");
        expect(res.body).toHaveProperty("token");
    });

    it("should not register a user with an existing email", async () => {
        // First, register a user
        await request(app).post("/auth/register").send({
            firstName: "Test",
            lastName: "User",
            email: "test@example.com",
            password: "password123",
        });

        // Try to register again with the same email
        const res = await request(app).post("/auth/register").send({
            firstName: "Test",
            lastName: "User",
            email: "test@example.com",
            password: "password123",
        });

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty("message", "User already exists");
    });
});

describe("POST /auth/login", () => {
    it("should login an existing user", async () => {
        // First, register a user
        await request(app).post("/auth/register").send({
            firstName: "Login",
            lastName: "Test User",
            email: "logintest@example.com",
            password: "password123",
        });

        // Now, try to login
        const res = await request(app).post("/auth/login").send({
            email: "logintest@example.com",
            password: "password123",
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("token");
        userToken = res.body.token;
    });

    it("should not login with incorrect credentials", async () => {
        const res = await request(app).post("/auth/login").send({
            email: "logintest@example.com",
            password: "wrongpassword",
        });

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty("message", "Incorrect password.");
    });
});

describe("GET /auth/me", () => {
    it("should return user information for authenticated user", async () => {
        //Add permission to the user to read their own information
        const newPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "baasix_User",
                action: "read",
                fields: "*",
            });

        const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${userToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("user");
        expect(res.body.user.email).toBe("logintest@example.com");
    });

    it("should not return user information without authentication", async () => {
        const res = await request(app).get("/auth/me");

        expect(res.statusCode).toBe(401);
    });
});

// Clean up created users after all tests
afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});

