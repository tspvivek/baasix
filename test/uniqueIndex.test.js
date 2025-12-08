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

    // Create test schema without unique index
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "userRoles",
            schema: {
                name: "UserRole",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    user_Id: { type: "UUID", allowNull: false },
                    role_Id: { type: "UUID", allowNull: false },
                },
            },
        });

    // Add unique index using the new schema index route
    await request(app)
        .post("/schemas/userRoles/indexes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            fields: ["user_Id", "role_Id"],
            unique: true,
            name: "userRole_unique",
        });
});

describe("Unique Index Tests", () => {
    test("Create entries with unique index", async () => {
        // Create first entry
        const response1 = await request(app)
            .post("/items/userRoles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                user_Id: "123e4567-e89b-12d3-a456-426614174000",
                role_Id: "123e4567-e89b-12d3-a456-426614174001",
            });

        expect(response1.status).toBe(201);

        // Create second entry with different user_Id
        const response2 = await request(app)
            .post("/items/userRoles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                user_Id: "223e4567-e89b-12d3-a456-426614174000",
                role_Id: "123e4567-e89b-12d3-a456-426614174001",
            });

        expect(response2.status).toBe(201);

        // Attempt to create entry violating unique constraint
        const response3 = await request(app)
            .post("/items/userRoles")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                user_Id: "123e4567-e89b-12d3-a456-426614174000",
                role_Id: "123e4567-e89b-12d3-a456-426614174001",
            });

        console.info("response3", response3.body);

        expect(response3.status).toBe(409); // Conflict status code
        expect(response3.body.error.message).toContain("Unique constraint violation");
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
