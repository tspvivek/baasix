import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";

let app;
let adminToken;
let userToken;

const testSchema = {
    name: "TestModel",
    fields: {
        id: { type: "SUID", primaryKey: true, defaultValue: { type: "SUID" } },
        name: { type: "String" },
        email: { type: "String", unique: true },
    },
};

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    console.log("App started");

    // Log in as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    console.log('Admin login response:', JSON.stringify(adminLoginResponse.body, null, 2));
    adminToken = adminLoginResponse.body.token;

    // Create a regular user
    await request(app).post("/auth/register").send({
        firstName: "Regular",
        lastName: "User",
        email: "user@test.com",
        password: "userpassword",
    });

    // Log in as regular user
    const userLoginResponse = await request(app).post("/auth/login").send({
        email: "user@test.com",
        password: "userpassword",
    });
    userToken = userLoginResponse.body.token;
});

describe("Schema Routes with Access Control", () => {
    test("Admin can create a new schema", async () => {
        console.log("Admin can create a new schema");

        const response = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ collectionName: "TestModel", schema: testSchema });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe("Schema created successfully");
    });

    test("Regular user cannot create a new schema", async () => {
        const response = await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ collectionName: "UserTestModel", schema: testSchema });

        console.log(response.body);

        expect(response.status).toBe(403);
        expect(response.body.error.message).toBe("Access denied. Administrators only.");
    });

    test("Both admin and regular user can get all schemas", async () => {
        const adminResponse = await request(app).get("/schemas").set("Authorization", `Bearer ${adminToken}`);

        expect(adminResponse.status).toBe(200);
        expect(Array.isArray(adminResponse.body.data)).toBe(true);

        const userResponse = await request(app).get("/schemas").set("Authorization", `Bearer ${userToken}`);

        expect(userResponse.status).toBe(200);
        expect(Array.isArray(userResponse.body.data)).toBe(true);
    });

    test("Both admin and regular user can get a specific schema", async () => {
        const adminResponse = await request(app).get("/schemas/TestModel").set("Authorization", `Bearer ${adminToken}`);

        console.log("FAILED TEST",adminResponse.body);

        expect(adminResponse.status).toBe(200);
        expect(adminResponse.body.data.collectionName).toBe("TestModel");

        const userResponse = await request(app).get("/schemas/TestModel").set("Authorization", `Bearer ${userToken}`);

        expect(userResponse.status).toBe(200);
        expect(userResponse.body.data.collectionName).toBe("TestModel");
    });

    test("Admin can update an existing schema", async () => {
        const updatedSchema = {
            ...testSchema,
            fields: {
                ...testSchema.fields,
                newField: { type: "String" },
            },
        };

        const response = await request(app)
            .patch("/schemas/TestModel")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ schema: updatedSchema });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("Schema updated successfully");
    });

    test("Regular user cannot update an existing schema", async () => {
        const updatedSchema = {
            ...testSchema,
            fields: {
                ...testSchema.fields,
                userNewField: { type: "String" },
            },
        };

        const response = await request(app)
            .patch("/schemas/TestModel")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ schema: updatedSchema });

        expect(response.status).toBe(403);
        expect(response.body.error.message).toBe("Access denied. Administrators only.");
    });

    test("Admin can delete a schema", async () => {
        const response = await request(app).delete("/schemas/TestModel").set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("Schema deleted successfully");
    });

    /*
    test("Regular user cannot delete a schema", async () => {
        // First, recreate the schema as admin
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ collectionName: "TestModel", schema: testSchema });

        const response = await request(app).delete("/schemas/TestModel").set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(403);
        expect(response.body.error.message).toBe("Access denied. Administrators only.");
    }); */
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
