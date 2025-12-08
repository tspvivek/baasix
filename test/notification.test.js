import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let userToken;
let testUserId;
let secondUserToken;
let secondUserId;

describe("Notification API Tests", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;
        
        // Create first test user
        const firstUserResponse = await request(app).post("/auth/register").send({
            firstName: "Test",
            lastName: "User",
            email: "testuser@test.com",
            password: "userpassword"
        });
        testUserId = firstUserResponse.body.user.id;

        // Login as first test user
        const userLoginResponse = await request(app).post("/auth/login").send({
            email: "testuser@test.com",
            password: "userpassword"
        });
        userToken = userLoginResponse.body.token;

        // Create second test user
        const secondUserResponse = await request(app).post("/auth/register").send({
            firstName: "Second",
            lastName: "User",
            email: "seconduser@test.com",
            password: "userpassword"
        });
        secondUserId = secondUserResponse.body.user.id;

        // Login as second test user
        const secondUserLoginResponse = await request(app).post("/auth/login").send({
            email: "seconduser@test.com",
            password: "userpassword"
        });
        secondUserToken = secondUserLoginResponse.body.token;

        // Set up permissions for users to access notifications
        const permissions = [
            {
                role_Id: firstUserResponse.body.role.id,
                collection: "baasix_Notification",
                action: "read",
                fields: "*",
                conditions: {
                    userId: { eq: "$CURRENT_USER.id" }
                }
            },
            {
                role_Id: firstUserResponse.body.role.id,
                collection: "baasix_Notification",
                action: "update",
                fields: ["seen"],
                conditions: {
                    userId: { eq: "$CURRENT_USER.id" }
                }
            },
            {
                role_Id: firstUserResponse.body.role.id,
                collection: "baasix_Notification",
                action: "delete",
                conditions: {
                    userId: { eq: "$CURRENT_USER.id" }
                }
            },
            // Same permissions for second user
            {
                role_Id: secondUserResponse.body.role.id,
                collection: "baasix_Notification",
                action: "read",
                fields: "*",
                conditions: {
                    userId: { eq: "$CURRENT_USER.id" }
                }
            },
            {
                role_Id: secondUserResponse.body.role.id,
                collection: "baasix_Notification",
                action: "update",
                fields: ["seen"],
                conditions: {
                    userId: { eq: "$CURRENT_USER.id" }
                }
            },
            {
                role_Id: secondUserResponse.body.role.id,
                collection: "baasix_Notification",
                action: "delete",
                conditions: {
                    userId: { eq: "$CURRENT_USER.id" }
                }
            }
        ];

        // Create permissions
        for (const permission of permissions) {
            await request(app)
                .post("/permissions")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(permission);
        }
    });

    describe("Send Notifications Tests", () => {
        test("Admin can send notifications to multiple users", async () => {
            const notificationData = {
                type: "info",
                title: "Test Notification",
                message: "This is a test notification",
                data: { testKey: "testValue" },
                userIds: [testUserId, secondUserId]
            };

            const response = await request(app)
                .post("/notifications/send")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(notificationData);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("notificationIds");
            expect(response.body.notificationIds).toHaveLength(2);
            expect(response.body.message).toBe("Notifications sent successfully");
        });

        test("Regular user cannot send notifications", async () => {
            const notificationData = {
                type: "info",
                title: "Test Notification",
                message: "This is a test notification",
                userIds: [secondUserId]
            };

            const response = await request(app)
                .post("/notifications/send")
                .set("Authorization", `Bearer ${userToken}`)
                .send(notificationData);

            expect(response.status).toBe(403);
        });

        test("Send notification fails with invalid data", async () => {
            const invalidData = {
                title: "Test Notification",
                // Missing required fields
                userIds: [testUserId]
            };

            const response = await request(app)
                .post("/notifications/send")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(invalidData);

            expect(response.status).toBe(400);
        });
    });

    describe("Get Notifications Tests", () => {
        test("User can get their notifications", async () => {
            const response = await request(app)
                .get("/notifications")
                .set("Authorization", `Bearer ${userToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("data");
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test("User can get paginated notifications", async () => {
            // First create multiple notifications
            await request(app)
                .post("/notifications/send")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "info",
                    title: "Pagination Test",
                    message: "Test message",
                    userIds: [testUserId],
                    data: { page: "test" }
                });

            const response = await request(app)
                .get("/notifications")
                .query({ limit: 2, page: 1 })
                .set("Authorization", `Bearer ${userToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeLessThanOrEqual(2);
            expect(response.body).toHaveProperty("totalCount");
        });

        test("User cannot access other user's notifications", async () => {
            // Create notification for first user
            await request(app)
                .post("/notifications/send")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "info",
                    title: "Private Notification",
                    message: "This should not be visible to other users",
                    userIds: [testUserId]
                });

            // Try to get notifications as second user
            const response = await request(app)
                .get("/notifications")
                .set("Authorization", `Bearer ${secondUserToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.every(notification => 
                notification.userId === secondUserId
            )).toBe(true);
        });
    });

    describe("Unread Count Tests", () => {
        test("User can get unread notifications count", async () => {
            const response = await request(app)
                .get("/notifications/unread/count")
                .set("Authorization", `Bearer ${userToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("count");
            expect(typeof response.body.count).toBe("number");
        });
    });

    describe("Mark as Seen Tests", () => {
        test("User can mark all notifications as seen", async () => {
            const response = await request(app)
                .post("/notifications/mark-seen")
                .set("Authorization", `Bearer ${userToken}`)
                .send({});

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("count");

            // Verify unread count is now 0
            const countResponse = await request(app)
                .get("/notifications/unread/count")
                .set("Authorization", `Bearer ${userToken}`);

            expect(countResponse.body.count).toBe(0);
        });

        test("User can mark specific notifications as seen", async () => {
            // First create new notifications
            const sendResponse = await request(app)
                .post("/notifications/send")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "info",
                    title: "Mark Seen Test",
                    message: "Test message",
                    userIds: [testUserId]
                });

            const notificationIds = sendResponse.body.notificationIds;

            const response = await request(app)
                .post("/notifications/mark-seen")
                .set("Authorization", `Bearer ${userToken}`)
                .send({ notificationIds });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("count");
        });
    });

    describe("Delete Notifications Tests", () => {
        test("User can delete their notifications", async () => {
            // First create notifications to delete
            const sendResponse = await request(app)
                .post("/notifications/send")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "info",
                    title: "Delete Test",
                    message: "Test message",
                    userIds: [testUserId]
                });

            const notificationIds = sendResponse.body.notificationIds;

            const response = await request(app)
                .delete("/notifications")
                .set("Authorization", `Bearer ${userToken}`)
                .send({ notificationIds });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("count");

            // Verify notifications are deleted
            const getResponse = await request(app)
                .get("/notifications")
                .set("Authorization", `Bearer ${userToken}`);

            expect(getResponse.body.data.every(notification => 
                !notificationIds.includes(notification.id)
            )).toBe(true);
        });
    });

    describe("Cleanup Notifications Tests", () => {
        test("Admin can cleanup old notifications", async () => {
            const response = await request(app)
                .post("/notifications/cleanup")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ days: 30 });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("count");
        });

        test("Regular user cannot cleanup notifications", async () => {
            const response = await request(app)
                .post("/notifications/cleanup")
                .set("Authorization", `Bearer ${userToken}`)
                .send({ days: 30 });

            expect(response.status).toBe(403);
        });
    });

    describe("Authentication Tests", () => {
        test("Unauthenticated user cannot access notifications", async () => {
            const response = await request(app).get("/notifications");
            expect(response.status).toBe(401);
        });

        test("Invalid token cannot access notifications", async () => {
            const response = await request(app)
                .get("/notifications")
                .set("Authorization", "Bearer invalid_token");

            expect(response.status).toBe(401);
        });
    });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});