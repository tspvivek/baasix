import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

describe("Mixed Filter Format Test ($ and non-$ delimiters)", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;

        // Create test schema
        await setupTestSchema();

        // Create test data
        await setupTestData();
    });

    async function setupTestSchema() {
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "users",
                schema: {
                    name: "User",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        age: { type: "Integer", allowNull: false },
                        email: { type: "String", allowNull: false },
                        status: { type: "String", allowNull: false, defaultValue: "active" },
                    },
                },
            });
    }

    async function setupTestData() {
        // Create test users
        await request(app).post("/items/users").set("Authorization", `Bearer ${adminToken}`).send({
            name: "John Doe",
            age: 30,
            email: "john@example.com",
            status: "active",
        });

        await request(app).post("/items/users").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Jane Smith",
            age: 25,
            email: "jane@example.com",
            status: "active",
        });

        await request(app).post("/items/users").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Bob Johnson",
            age: 35,
            email: "bob@example.com",
            status: "inactive",
        });

        await request(app).post("/items/users").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Alice Brown",
            age: 28,
            email: "alice@example.com",
            status: "active",
        });
    }

    test("Filter with mixed $ and non-$ delimiters in AND condition", async () => {
        const response = await request(app)
            .get("/items/users")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    AND: [
                        { "$status$": { eq: "active" } },  // with $ delimiters
                        { "age": { gte: 28 } }              // without $ delimiters
                    ]
                }),
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.length).toBe(2); // John (30) and Alice (28)

        const names = response.body.data.map(u => u.name).sort();
        expect(names).toEqual(["Alice Brown", "John Doe"]);
    });

    test("Filter with mixed $ and non-$ delimiters in OR condition", async () => {
        const response = await request(app)
            .get("/items/users")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    OR: [
                        { "name": { eq: "John Doe" } },     // without $ delimiters
                        { "$age$": { lt: 27 } }             // with $ delimiters
                    ]
                }),
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.length).toBe(2); // John Doe and Jane Smith (age 25)

        const names = response.body.data.map(u => u.name).sort();
        expect(names).toEqual(["Jane Smith", "John Doe"]);
    });

    test("Complex nested filter with mixed formats", async () => {
        const response = await request(app)
            .get("/items/users")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    AND: [
                        {
                            OR: [
                                { "$name$": { like: "John" } },    // with $
                                { "name": { like: "Alice" } }       // without $
                            ]
                        },
                        { "status": { eq: "active" } }             // without $
                    ]
                }),
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.length).toBe(2); // John Doe and Alice Brown

        const names = response.body.data.map(u => u.name).sort();
        expect(names).toEqual(["Alice Brown", "John Doe"]);
    });

    test("Filter mixing both formats at same level", async () => {
        const response = await request(app)
            .get("/items/users")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "$status$": { eq: "active" },  // with $ delimiters
                    "age": { gte: 30 }              // without $ delimiters (both are AND by default)
                }),
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.length).toBe(1); // Only John (30, active)

        expect(response.body.data[0].name).toBe("John Doe");
    });

    afterAll(async () => {
        if (app.server) {
            await new Promise((resolve) => app.server.close(resolve));
        }
    });
});
