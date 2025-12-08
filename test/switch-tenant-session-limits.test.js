import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import { ItemsService } from "../baasix/services/ItemsService";

let app;
let adminToken;

describe("Switch Tenant Session Limits", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "true" } });

        // Get admin token for API calls
        const loginRes = await request(app).post("/auth/login").send({
            email: "admin@baasix.com",
            password: "admin@123",
        });
        adminToken = loginRes.body.token;
    });

    afterAll(async () => {
        // No need to close anything, handled by test framework
    });

    test("should enforce session limits when switching tenants with authType", async () => {
        // Create service instances (no accountability needed for test setup)
        const settingsService = new ItemsService('baasix_Settings');
        const tenantService = new ItemsService('baasix_Tenant');
        const userService = new ItemsService('baasix_User');
        const roleService = new ItemsService('baasix_Role');
        const userRoleService = new ItemsService('baasix_UserRole');

        // Clear existing settings via API
        const existingSettings = await settingsService.readByQuery({ limit: -1 }, true);
        for (const setting of existingSettings.data) {
            await settingsService.deleteOne(setting.id);
        }

        // Create a tenant-specific role
        const tenantRoleId = await roleService.createOne({
            name: "tenant_admin",
            isTenantSpecific: true,
        });

        // Create two tenants
        const tenant1Id = await tenantService.createOne({
            name: "Tenant 1",
        });

        const tenant2Id = await tenantService.createOne({
            name: "Tenant 2",
        });

        // Create settings for tenant 2 with mobile session limit of 1 via API
        await request(app)
            .patch(`/settings?tenant_id=${tenant2Id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                project_name: "Tenant 2 Project",
                mobile_session_limit: 1,
            });

        // Reload settings cache
        await request(app)
            .get("/settings/reload")
            .set("Authorization", `Bearer ${adminToken}`);

        // Get admin user
        const adminUserResult = await userService.readByQuery({
            filter: { email: "admin@baasix.com" },
            limit: 1
        }, true);
        const adminUser = adminUserResult.data[0];

        // Create user-role associations for both tenants
        await userRoleService.createOne({
            user_Id: adminUser.id,
            role_Id: tenantRoleId,
            tenant_Id: tenant1Id,
        });

        await userRoleService.createOne({
            user_Id: adminUser.id,
            role_Id: tenantRoleId,
            tenant_Id: tenant2Id,
        });

        // Login to tenant 1 first (no limits)
        const loginResponse = await request(app).post("/auth/login").send({
            email: "admin@baasix.com",
            password: "admin@123",
            tenant_Id: tenant1Id,
        });

        expect(loginResponse.status).toBe(200);
        const userToken = loginResponse.body.token;

        // Create a mobile session for tenant 2 (should reach the limit)
        const mobileLoginResponse = await request(app).post("/auth/login").send({
            email: "admin@baasix.com",
            password: "admin@123",
            tenant_Id: tenant2Id,
            authType: "mobile",
        });

        expect(mobileLoginResponse.status).toBe(200);

        // Now try to switch to tenant 2 with mobile authType - should fail due to limit
        const switchResponse = await request(app)
            .post("/auth/switch-tenant")
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                tenant_Id: tenant2Id,
                authType: "mobile",
            });

        expect(switchResponse.status).toBe(403);
        expect(switchResponse.body.message).toContain("Maximum mobile session limit");
    });

    test("should allow switch-tenant without authType (default)", async () => {
        // Get necessary services
        const tenantService = new ItemsService('baasix_Tenant');

        // Get existing tenants
        const tenant1Result = await tenantService.readByQuery({
            filter: { name: "Tenant 1" },
            limit: 1
        }, true);
        const tenant1 = tenant1Result.data[0];

        const tenant2Result = await tenantService.readByQuery({
            filter: { name: "Tenant 2" },
            limit: 1
        }, true);
        const tenant2 = tenant2Result.data[0];

        // Login to tenant 1
        const loginResponse = await request(app).post("/auth/login").send({
            email: "admin@baasix.com",
            password: "admin@123",
            tenant_Id: tenant1.id,
        });

        expect(loginResponse.status).toBe(200);
        const userToken = loginResponse.body.token;

        // Switch to tenant 2 without authType (should use "default" and bypass limits)
        const switchResponse = await request(app)
            .post("/auth/switch-tenant")
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                tenant_Id: tenant2.id,
            });

        expect(switchResponse.status).toBe(200);
        expect(switchResponse.body.token).toBeDefined();
        expect(switchResponse.body.tenant.id).toBe(tenant2.id);
    });

    test("should allow switch-tenant when within session limits", async () => {
        // Get necessary services
        const tenantService = new ItemsService('baasix_Tenant');
        const sessionService = new ItemsService('baasix_Sessions');

        // Clear all sessions first
        const existingSessions = await sessionService.readByQuery({ limit: -1 }, true);
        for (const session of existingSessions.data) {
            await sessionService.deleteOne(session.id);
        }

        // Get existing tenants
        const tenant1Result = await tenantService.readByQuery({
            filter: { name: "Tenant 1" },
            limit: 1
        }, true);
        const tenant1 = tenant1Result.data[0];

        const tenant2Result = await tenantService.readByQuery({
            filter: { name: "Tenant 2" },
            limit: 1
        }, true);
        const tenant2 = tenant2Result.data[0];

        // Update settings to allow 2 mobile sessions for tenant 2 via API
        await request(app)
            .patch(`/settings?tenant_id=${tenant2.id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                mobile_session_limit: 2,
            });

        // Reload settings cache
        await request(app)
            .get("/settings/reload")
            .set("Authorization", `Bearer ${adminToken}`);

        // Login to tenant 1
        const loginResponse = await request(app).post("/auth/login").send({
            email: "admin@baasix.com",
            password: "admin@123",
            tenant_Id: tenant1.id,
        });

        expect(loginResponse.status).toBe(200);
        const userToken = loginResponse.body.token;

        // Switch to tenant 2 with mobile authType (should succeed since limit is 2 and we have 0)
        const switchResponse = await request(app)
            .post("/auth/switch-tenant")
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                tenant_Id: tenant2.id,
                authType: "mobile",
            });

        expect(switchResponse.status).toBe(200);
        expect(switchResponse.body.token).toBeDefined();
        expect(switchResponse.body.tenant.id).toBe(tenant2.id);

        // Verify the session was created with mobile type
        const sessions = await sessionService.readByQuery({
            filter: { type: "mobile" },
            limit: -1
        }, true);
        expect(sessions.data.length).toBeGreaterThan(0);
    });
});
