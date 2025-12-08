import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;
let userRoleId;

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    console.log("Admin token:", adminToken);

    // Create a test user role
    const userRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "testuser", description: "Test user role" });
    userRoleId = userRoleResponse.body.data?.id;

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
});

describe("Permission Routes", () => {
    let permissionId;

    test("Create a new permission", async () => {
        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: userRoleId,
            collection: "test_collection",
            action: "read",
        });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty("id");
        permissionId = response.body.id;
    });

    test("List all permissions", async () => {
        const response = await request(app).get("/permissions").set("Authorization", `Bearer ${adminToken}`);

        console.log("Permissions:", response.body);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
    });

    test("Update a permission", async () => {
        const response = await request(app)
            .patch(`/permissions/${permissionId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "update",
            });

        expect(response.status).toBe(200);
        expect(response.body.action).toBe("update");
    });

    test("Delete a permission", async () => {
        const response = await request(app)
            .delete(`/permissions/${permissionId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(204);
    });

    test("Manually reload permission cache", async () => {
        const response = await request(app).post("/permissions/reload").set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
    });

    test("Non-admin user cannot create a permission", async () => {
        const response = await request(app).post("/permissions").set("Authorization", `Bearer ${userToken}`).send({
            role_Id: userRoleId,
            collection: "test_collection",
            action: "read",
        });

        expect(response.status).toBe(403);
    });

    test("Non-admin user cannot update a permission", async () => {
        // First, create a permission as admin
        const createResponse = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "test_collection",
                action: "read",
            });

        const permissionId = createResponse.body.id;

        // Attempt to update as non-admin user
        const response = await request(app)
            .patch(`/permissions/${permissionId}`)
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                action: "update",
            });

        expect(response.status).toBe(403);
    });

    test("Non-admin user cannot delete a permission", async () => {
        // First, create a permission as admin
        const createResponse = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: userRoleId,
                collection: "test_collection",
                action: "read",
            });

        const permissionId = createResponse.body.id;

        // Attempt to delete as non-admin user
        const response = await request(app)
            .delete(`/permissions/${permissionId}`)
            .set("Authorization", `Bearer ${userToken}`);

        expect(response.status).toBe(403);
    });

    test("Complex role-based permission filtering with OR conditions and nested relations", async () => {
        // Create additional test users with different roles
        const regularUserRoleResponse = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "regularuser", description: "Regular user role" });
        const regularUserRoleId = regularUserRoleResponse.body.data?.id;

        const moderatorRoleResponse = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "moderatorrole", description: "Moderator role" });
        const moderatorRoleId = moderatorRoleResponse.body.data?.id;

        // Create test users
        const currentUser = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                firstName: "Current",
                lastName: "User",
                email: "current@test.com",
                password: "password123",
            });
        const currentUserId = currentUser.body.data.id;

        const regularUser = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                firstName: "Regular",
                lastName: "User",
                email: "regular@test.com",
                password: "password123",
            });
        const regularUserId = regularUser.body.data.id;

        const moderatorUser = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                firstName: "Moderator",
                lastName: "User",
                email: "moderator@test.com",
                password: "password123",
            });
        const moderatorUserId = moderatorUser.body.data.id;

        // Assign roles to users
        await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
            user_Id: currentUserId,
            role_Id: regularUserRoleId,
        });

        await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
            user_Id: regularUserId,
            role_Id: regularUserRoleId,
        });

        await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
            user_Id: moderatorUserId,
            role_Id: moderatorRoleId,
        });

        // Create permission with complex OR condition for baasix_User collection
        const complexPermission = await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: regularUserRoleId,
                collection: "baasix_User",
                action: "read",
                fields: ["*"],
                conditions: {
                    OR: [
                        {
                            id: {
                                eq: "$CURRENT_USER",
                            },
                        },
                        {
                            "userRoles.role.name": {
                                in: ["regularuser"],
                            },
                        },
                    ],
                },
            });

        expect(complexPermission.status).toBe(201);
        const complexPermissionId = complexPermission.body.id;

        // Login as the current user to test the permission
        const currentUserLogin = await request(app).post("/auth/login").send({
            email: "current@test.com",
            password: "password123",
        });
        const currentUserToken = currentUserLogin.body.token;

        // Test reading users with the complex permission
        // Should return: current user (matches $CURRENT_USER) + users with "user" role
        const usersResponse = await request(app)
            .get("/items/baasix_User")
            .set("Authorization", `Bearer ${currentUserToken}`)
            .query({
                fields: JSON.stringify(["id", "firstName", "email", "userRoles.role.name"]),
                sort: JSON.stringify({ "userRoles.role.name": "asc" }),
            });

        console.info("Complex permission test - Users response:", JSON.stringify(usersResponse.body, null, 2));

        expect(usersResponse.status).toBe(200);
        expect(usersResponse.body.data).toBeDefined();

        // Should include current user (self) and regular user (has "regularuser" role)
        // Should NOT include moderator user (has different role)
        const returnedUserIds = usersResponse.body.data.map((user) => user.id);
        expect(returnedUserIds).toContain(currentUserId); // Current user (self)
        expect(returnedUserIds).toContain(regularUserId); // Has "regularuser" role
        expect(returnedUserIds).not.toContain(moderatorUserId); // Has "moderatorrole" role, not "regularuser"

        // Verify the OR logic works correctly
        expect(usersResponse.body.data.length).toBeGreaterThanOrEqual(2);

        // Test with a user that has moderator role to ensure they can't see users
        const moderatorLogin = await request(app).post("/auth/login").send({
            email: "moderator@test.com",
            password: "password123",
        });
        const moderatorToken = moderatorLogin.body.token;

        // Moderator should not have permission to read users (no permission granted to moderator role)
        const moderatorUsersResponse = await request(app)
            .get("/items/baasix_User")
            .set("Authorization", `Bearer ${moderatorToken}`)
            .query({ fields: JSON.stringify(["id", "firstName", "email"]) });

        expect(moderatorUsersResponse.status).toBe(403);

        // Clean up the permission
        await request(app).delete(`/permissions/${complexPermissionId}`).set("Authorization", `Bearer ${adminToken}`);
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
