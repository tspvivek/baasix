import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import path from "path";
import { fileURLToPath } from "url";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Test suite for isPublic field in baasix_File
 * Tests that public files bypass tenant-specific restrictions
 */
describe("Assets - isPublic Field Tests", () => {
    let app;
    let adminToken;
    let tenant1Id;
    let tenant2Id;
    let tenant1UserToken;
    let tenant2UserToken;
    let publicFileId;
    let privateFileId;
    let tenant1FileId;
    let tenantRoleId;

    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "true" } });

        // Get admin token (default admin user)
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;

        // Create test tenants using API (returns { data: { id: "..." } })
        const tenant1Response = await request(app)
            .post("/items/baasix_Tenant")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Tenant One" });
        tenant1Id = tenant1Response.body.data.id;

        const tenant2Response = await request(app)
            .post("/items/baasix_Tenant")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ name: "Tenant Two" });
        tenant2Id = tenant2Response.body.data.id;

        // Create a tenant-specific role using API
        const tenantRoleResponse = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "tenant_user",
                description: "Tenant-specific user role",
                isTenantSpecific: true,
            });
        tenantRoleId = tenantRoleResponse.body.data.id;

        // Create permissions for tenant role on files using /permissions route (which reloads cache)
        await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: tenantRoleId,
                collection: "baasix_File",
                action: "read",
                fields: "*",
            });
        
        await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: tenantRoleId,
                collection: "baasix_File",
                action: "create",
                fields: "*",
            });
        
        await request(app)
            .post("/permissions")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                role_Id: tenantRoleId,
                collection: "baasix_File",
                action: "update",
                fields: "*",
            });

        // Create tenant-specific users using API
        const tenant1UserResponse = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                email: "user1@tenant1.com",
                password: "password123",
                firstName: "Tenant1",
                lastName: "User",
            });
        const tenant1UserId = tenant1UserResponse.body.data.id;

        const tenant2UserResponse = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                email: "user2@tenant2.com",
                password: "password123",
                firstName: "Tenant2",
                lastName: "User",
            });
        const tenant2UserId = tenant2UserResponse.body.data.id;

        // Assign tenant roles to users
        await request(app)
            .post("/items/baasix_UserRole")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                user_Id: tenant1UserId,
                role_Id: tenantRoleId,
                tenant_Id: tenant1Id,
            });

        await request(app)
            .post("/items/baasix_UserRole")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                user_Id: tenant2UserId,
                role_Id: tenantRoleId,
                tenant_Id: tenant2Id,
            });

        // Get tokens for tenant users
        const tenant1LoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "user1@tenant1.com", password: "password123", tenant_Id: tenant1Id });
        tenant1UserToken = tenant1LoginResponse.body.token;

        const tenant2LoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "user2@tenant2.com", password: "password123", tenant_Id: tenant2Id });
        tenant2UserToken = tenant2LoginResponse.body.token;

        // Upload test files using API routes with LOCAL storage
        const testFilePath = path.join(__dirname, "test-assets", "test-image.jpg");

        // Upload a file as admin (will be set as public later)
        const publicFileResponse = await request(app)
            .post("/files")
            .set("Authorization", `Bearer ${adminToken}`)
            .field("storage", "LOCAL")
            .attach("file", testFilePath);
        publicFileId = publicFileResponse.body.data;

        // Update file to be public and assign to tenant1 via API
        await request(app)
            .patch(`/files/${publicFileId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ isPublic: true, tenant_Id: tenant1Id });

        // Upload a private file and assign to tenant1
        const privateFileResponse = await request(app)
            .post("/files")
            .set("Authorization", `Bearer ${adminToken}`)
            .field("storage", "LOCAL")
            .attach("file", testFilePath);
        privateFileId = privateFileResponse.body.data;

        // Update file to be private and assign to tenant1 via API
        await request(app)
            .patch(`/files/${privateFileId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ isPublic: false, tenant_Id: tenant1Id });

        // Upload a file as tenant1 user (will have tenant1Id automatically)
        const tenant1FileResponse = await request(app)
            .post("/files")
            .set("Authorization", `Bearer ${tenant1UserToken}`)
            .field("storage", "LOCAL")
            .attach("file", testFilePath);
        tenant1FileId = tenant1FileResponse.body.data;
    });

    afterAll(async () => {
        if (app.server) {
            await new Promise((resolve) => app.server.close(resolve));
        }
    });

    describe("isPublic field default behavior", () => {
        test("should have isPublic defaulted to false for new files", async () => {
            const response = await request(app)
                .get(`/files/${tenant1FileId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.isPublic).toBe(false);
        });

        test("should create file with isPublic true in metadata", async () => {
            const testFilePath = path.join(__dirname, "test-assets", "test-image.jpg");
            
            const response = await request(app)
                .post("/files")
                .set("Authorization", `Bearer ${adminToken}`)
                .field("isPublic", "true")
                .field("storage", "LOCAL")
                .attach("file", testFilePath);

            expect(response.status).toBe(200);
            const newFileId = response.body.data;

            // Verify the file was created with isPublic = true
            const getResponse = await request(app)
                .get(`/files/${newFileId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            
            expect(getResponse.status).toBe(200);
            expect(getResponse.body.data.isPublic).toBe(true);
        });

        test("should allow admin to update isPublic field", async () => {
            // Update to public
            const updateResponse = await request(app)
                .patch(`/files/${tenant1FileId}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ isPublic: true });

            expect(updateResponse.status).toBe(200);

            // Verify it's updated
            const getResponse = await request(app)
                .get(`/files/${tenant1FileId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            
            expect(getResponse.body.data.isPublic).toBe(true);

            // Reset it back to private
            await request(app)
                .patch(`/files/${tenant1FileId}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ isPublic: false });
        });
    });

    describe("Tenant-specific role access to files", () => {
        test("tenant1 user should access their own tenant files", async () => {
            const response = await request(app)
                .get(`/files/${privateFileId}`)
                .set("Authorization", `Bearer ${tenant1UserToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.id).toBe(privateFileId);
        });

        test("tenant2 user should NOT access tenant1 private files", async () => {
            const response = await request(app)
                .get(`/files/${privateFileId}`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(response.status).toBe(403);
        });

        test("tenant2 user SHOULD access tenant1 public files", async () => {
            const response = await request(app)
                .get(`/files/${publicFileId}`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.id).toBe(publicFileId);
            expect(response.body.data.isPublic).toBe(true);
        });
    });

    describe("Asset route with isPublic", () => {
        test("tenant1 user should access their own tenant assets", async () => {
            const response = await request(app)
                .get(`/assets/${privateFileId}`)
                .set("Authorization", `Bearer ${tenant1UserToken}`);

            expect(response.status).toBe(200);
            expect(response.headers["content-type"]).toMatch(/image/);
        });

        test("tenant2 user should NOT access tenant1 private assets", async () => {
            const response = await request(app)
                .get(`/assets/${privateFileId}`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(response.status).toBe(403);
        });

        test("tenant2 user SHOULD access tenant1 public assets", async () => {
            const response = await request(app)
                .get(`/assets/${publicFileId}`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(response.status).toBe(200);
            expect(response.headers["content-type"]).toMatch(/image/);
        });

        test("public assets should be accessible with image transformations", async () => {
            const response = await request(app)
                .get(`/assets/${publicFileId}?width=100&height=100`)
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(response.status).toBe(200);
            expect(response.headers["content-type"]).toMatch(/image/);
        });
    });

    describe("Listing files with isPublic filter", () => {
        test("tenant1 user should see both their files and public files in list", async () => {
            const response = await request(app)
                .get("/files")
                .set("Authorization", `Bearer ${tenant1UserToken}`);

            expect(response.status).toBe(200);
            
            const fileIds = response.body.data.map(f => f.id);
            // Should see private file (same tenant)
            expect(fileIds).toContain(privateFileId);
            // Should see public file
            expect(fileIds).toContain(publicFileId);
            // Should see their own file
            expect(fileIds).toContain(tenant1FileId);
        });

        test("tenant2 user should only see public files from tenant1", async () => {
            const response = await request(app)
                .get("/files")
                .set("Authorization", `Bearer ${tenant2UserToken}`);

            expect(response.status).toBe(200);
            
            const fileIds = response.body.data.map(f => f.id);
            // Should NOT see private tenant1 file
            expect(fileIds).not.toContain(privateFileId);
            // Should NOT see tenant1's own file (private by default)
            expect(fileIds).not.toContain(tenant1FileId);
            // SHOULD see public file
            expect(fileIds).toContain(publicFileId);
        });
    });

    describe("Admin access", () => {
        test("admin should access all files regardless of tenant or isPublic", async () => {
            // Access private file
            const privateResponse = await request(app)
                .get(`/files/${privateFileId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(privateResponse.status).toBe(200);

            // Access public file
            const publicResponse = await request(app)
                .get(`/files/${publicFileId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(publicResponse.status).toBe(200);

            // Access tenant1's file
            const tenant1Response = await request(app)
                .get(`/files/${tenant1FileId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(tenant1Response.status).toBe(200);
        });
    });
});
