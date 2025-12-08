import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import settingsService from "../baasix/services/SettingsService";
import ItemsService from "../baasix/services/ItemsService";

let app;
let adminToken;

describe("Session Types and Limits", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin to get token
        const response = await request(app)
            .post("/auth/login")
            .send({
                email: "admin@baasix.com",
                password: "admin@123",
            });
        adminToken = response.body.token;

        // Create a test user with 'user' role for role-based limit testing
        await request(app)
            .post("/auth/register")
            .send({
                email: "testuser@example.com",
                password: "password123",
                firstName: "Test",
                lastName: "User",
            });
    });

    afterAll(async () => {
        // No need to close anything, handled by test framework
    });

    test("should create session with default type when no type specified", async () => {
        const response = await request(app)
            .post("/auth/login")
            .send({
                email: "admin@baasix.com",
                password: "admin@123",
            });

        expect(response.status).toBe(200);
        expect(response.body.token).toBeDefined();

        // Check session in database
        const sessionService = new ItemsService('baasix_Sessions');
        const sessions = await sessionService.readByQuery({
            limit: -1,
            sort: ['createdAt']
        }, true);
        const latestSession = sessions.data[sessions.data.length - 1];
        expect(latestSession.type).toBe("default");
    });

    test("should create session with mobile type when specified", async () => {
        const response = await request(app)
            .post("/auth/login")
            .send({
                email: "admin@baasix.com",
                password: "admin@123",
                authType: "mobile"
            });

        expect(response.status).toBe(200);
        expect(response.body.token).toBeDefined();

        // Check session in database
        const sessionService = new ItemsService('baasix_Sessions');
        const sessions = await sessionService.readByQuery({
            filter: { type: { eq: "mobile" } },
            limit: -1
        }, true);
        expect(sessions.data.length).toBeGreaterThan(0);
    });

    test("should create session with web type when specified", async () => {
        const response = await request(app)
            .post("/auth/login")
            .send({
                email: "admin@baasix.com",
                password: "admin@123",
                authType: "web"
            });

        expect(response.status).toBe(200);
        expect(response.body.token).toBeDefined();

        // Check session in database
        const sessionService = new ItemsService('baasix_Sessions');
        const sessions = await sessionService.readByQuery({
            filter: { type: { eq: "web" } },
            limit: -1
        }, true);
        expect(sessions.data.length).toBeGreaterThan(0);
    });

    test("should reject invalid session type", async () => {
        const response = await request(app)
            .post("/auth/login")
            .send({
                email: "admin@baasix.com",
                password: "admin@123",
                authType: "invalid_type"
            });

        expect(response.status).toBe(403);
        expect(response.body.message).toContain("Invalid session type");
    });

    test("should enforce session limits using dedicated fields", async () => {
        // Clear existing settings and sessions, then create new ones with session limits
        const settingsServiceInstance = new ItemsService('baasix_Settings');
        const sessionService = new ItemsService('baasix_Sessions');

        // Delete any existing settings and sessions first
        const existingSettings = await settingsServiceInstance.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsServiceInstance.deleteOne(setting.id);
        }
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }

        // Create new settings with dedicated limit fields (new approach)
        await settingsServiceInstance.createOne({
            tenant_Id: null,
            project_name: "Test Project",
            mobile_session_limit: 1,
            web_session_limit: 2,
            session_limit_roles: null // null means apply to all roles except administrator
        });

        // Invalidate SettingsService cache and reload to pick up new settings
        settingsService.invalidateAllCaches();
        await settingsService.loadGlobalSettings();

        // First mobile login for test user should succeed
        const response1 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response1.status).toBe(200);

        // Second mobile login for test user should fail due to limit
        const response2 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response2.status).toBe(403);
        expect(response2.body.message).toContain("Maximum mobile session limit");
    });

    test("should block login when session limit is set to 0 using dedicated fields", async () => {
        // Create settings with mobile sessions disabled
        const settingsServiceInstance = new ItemsService('baasix_Settings');
        const sessionService = new ItemsService('baasix_Sessions');
        
        // Clear existing settings and sessions
        const existingSettings = await settingsServiceInstance.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsServiceInstance.deleteOne(setting.id);
        }
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }
        
        await settingsServiceInstance.createOne({
            tenant_Id: null,
            project_name: "Test Project",
            mobile_session_limit: 0, // Disabled
            web_session_limit: -1,   // Unlimited
            session_limit_roles: null
        });

        // Invalidate SettingsService cache and reload to pick up new settings
        settingsService.invalidateAllCaches();
        await settingsService.loadGlobalSettings();

        const response = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });

        expect(response.status).toBe(403);
        expect(response.body.message).toContain("Mobile sessions are not allowed");
    });

    test("should allow unlimited default sessions regardless of limits", async () => {
        // Create settings with strict limits
        const settingsServiceInstance = new ItemsService('baasix_Settings');
        const sessionService = new ItemsService('baasix_Sessions');
        
        // Clear existing settings and sessions
        const existingSettings = await settingsServiceInstance.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsServiceInstance.deleteOne(setting.id);
        }
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }
        
        await settingsServiceInstance.createOne({
            tenant_Id: null,
            project_name: "Test Project",
            mobile_session_limit: 0,
            web_session_limit: 0,
            session_limit_roles: null
        });

        // Invalidate SettingsService cache and reload
        settingsService.invalidateAllCaches();
        await settingsService.loadGlobalSettings();

        // Default sessions should still work
        const response1 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123"
            });
        expect(response1.status).toBe(200);

        const response2 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "default"
            });
        expect(response2.status).toBe(200);
    });

    test("should always allow administrator role regardless of session limits", async () => {
        // Create settings with strict limits for all roles
        const settingsServiceInstance = new ItemsService('baasix_Settings');
        const sessionService = new ItemsService('baasix_Sessions');
        
        // Clear existing settings and sessions
        const existingSettings = await settingsServiceInstance.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsServiceInstance.deleteOne(setting.id);
        }
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }
        
        await settingsServiceInstance.createOne({
            tenant_Id: null,
            project_name: "Test Project",
            mobile_session_limit: 0, // Disabled
            web_session_limit: 0,    // Disabled
            session_limit_roles: null // Apply to all (except administrator)
        });

        settingsService.invalidateAllCaches();
        await settingsService.loadGlobalSettings();

        // Admin should still be able to login with mobile/web types
        const response1 = await request(app)
            .post("/auth/login")
            .send({
                email: "admin@baasix.com",
                password: "admin@123",
                authType: "mobile"
            });
        expect(response1.status).toBe(200);

        const response2 = await request(app)
            .post("/auth/login")
            .send({
                email: "admin@baasix.com",
                password: "admin@123",
                authType: "web"
            });
        expect(response2.status).toBe(200);
    });

    test("should only apply session limits to specified roles", async () => {
        const settingsServiceInstance = new ItemsService('baasix_Settings');
        const sessionService = new ItemsService('baasix_Sessions');
        const roleService = new ItemsService('baasix_Role');
        
        // Clear existing settings and sessions
        const existingSettings = await settingsServiceInstance.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsServiceInstance.deleteOne(setting.id);
        }
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }

        // Get the 'user' role ID
        const roles = await roleService.readByQuery({ filter: { name: { eq: 'user' } }, limit: 1 }, true);
        const userRole = roles.data[0];
        
        // Create settings with limits only for 'user' role
        await settingsServiceInstance.createOne({
            tenant_Id: null,
            project_name: "Test Project",
            mobile_session_limit: 1,
            web_session_limit: 1,
            session_limit_roles: [userRole.id] // Only apply to 'user' role
        });

        settingsService.invalidateAllCaches();
        await settingsService.loadGlobalSettings();

        // Test user (with 'user' role) should be limited
        const response1 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response1.status).toBe(200);

        // Second mobile login should fail due to limit
        const response2 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response2.status).toBe(403);
    });

    test("should not apply limits if role is not in session_limit_roles array", async () => {
        const settingsServiceInstance = new ItemsService('baasix_Settings');
        const sessionService = new ItemsService('baasix_Sessions');
        
        // Clear existing settings and sessions
        const existingSettings = await settingsServiceInstance.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsServiceInstance.deleteOne(setting.id);
        }
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }

        // Create settings with limits for a non-existent role ID
        await settingsServiceInstance.createOne({
            tenant_Id: null,
            project_name: "Test Project",
            mobile_session_limit: 0, // Would block if applied
            web_session_limit: 0,
            session_limit_roles: ['00000000-0000-0000-0000-000000000001'] // Non-existent role
        });

        settingsService.invalidateAllCaches();
        await settingsService.loadGlobalSettings();

        // Test user should be able to login since their role is not in the list
        const response = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response.status).toBe(200);
    });

    test("should allow unlimited sessions when limit is -1", async () => {
        const settingsServiceInstance = new ItemsService('baasix_Settings');
        const sessionService = new ItemsService('baasix_Sessions');
        
        // Clear existing settings and sessions
        const existingSettings = await settingsServiceInstance.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsServiceInstance.deleteOne(setting.id);
        }
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }

        // Create settings with unlimited limits (-1)
        await settingsServiceInstance.createOne({
            tenant_Id: null,
            project_name: "Test Project",
            mobile_session_limit: -1, // Unlimited
            web_session_limit: -1,    // Unlimited
            session_limit_roles: null
        });

        settingsService.invalidateAllCaches();
        await settingsService.loadGlobalSettings();

        // Should allow multiple mobile sessions
        const response1 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response1.status).toBe(200);

        const response2 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response2.status).toBe(200);

        const response3 = await request(app)
            .post("/auth/login")
            .send({
                email: "testuser@example.com",
                password: "password123",
                authType: "mobile"
            });
        expect(response3.status).toBe(200);
    });
});