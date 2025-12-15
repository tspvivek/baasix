import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import path from "path";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
/**
 * Test suite for token access methods
 * Tests that tokens work via Authorization header, cookie, and URL query parameter
 */
describe("Token Access Methods", () => {
    let app;
    let adminToken;
    let fileId;

    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Get admin token (default admin user)
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        
        console.log("Login response:", JSON.stringify(adminLoginResponse.body, null, 2));
        adminToken = adminLoginResponse.body.token;
        expect(adminToken).toBeDefined();

        // Upload a test file
        const testFilePath = path.join(__dirname, "test-assets", "test-image.jpg");
        const fileResponse = await request(app)
            .post("/files")
            .set("Authorization", `Bearer ${adminToken}`)
            .field("storage", "LOCAL")
            .attach("file", testFilePath);
        
        console.log("File upload response:", JSON.stringify(fileResponse.body, null, 2));
        fileId = fileResponse.body.data;
        expect(fileId).toBeDefined();
    });

    afterAll(async () => {
        if (app.server) {
            await new Promise((resolve) => app.server.close(resolve));
        }
    });

    describe("Access with Authorization header", () => {
        test("should access file with Bearer token in Authorization header", async () => {
            const response = await request(app)
                .get(`/assets/${fileId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            
            console.log("Header access status:", response.status);
            expect(response.status).toBe(200);
        });

        test("should access /auth/me with Bearer token in Authorization header", async () => {
            const response = await request(app)
                .get("/auth/me")
                .set("Authorization", `Bearer ${adminToken}`);
            
            console.log("/auth/me header response:", JSON.stringify(response.body, null, 2));
            expect(response.status).toBe(200);
            expect(response.body.user).toBeDefined();
        });
    });

    describe("Access with cookie", () => {
        test("should access file with token in cookie", async () => {
            const response = await request(app)
                .get(`/assets/${fileId}`)
                .set("Cookie", `token=${adminToken}`);
            
            console.log("Cookie access status:", response.status);
            console.log("Cookie access body:", JSON.stringify(response.body, null, 2));
            expect(response.status).toBe(200);
        });

        test("should access /auth/me with token in cookie", async () => {
            const response = await request(app)
                .get("/auth/me")
                .set("Cookie", `token=${adminToken}`);
            
            console.log("/auth/me cookie response:", JSON.stringify(response.body, null, 2));
            expect(response.status).toBe(200);
            expect(response.body.user).toBeDefined();
        });
    });

    describe("Access with URL query parameter", () => {
        test("should access file with access_token in URL query", async () => {
            console.log("Token being used:", adminToken);
            console.log("File ID:", fileId);
            
            const response = await request(app)
                .get(`/assets/${fileId}?access_token=${adminToken}`);
            
            console.log("URL query access status:", response.status);
            console.log("URL query access headers:", response.headers);
            console.log("URL query access body:", JSON.stringify(response.body, null, 2));
            expect(response.status).toBe(200);
        });

        test("should access file with access_token and download in URL query", async () => {
            const response = await request(app)
                .get(`/assets/${fileId}?download=true&access_token=${adminToken}`);
            
            console.log("URL query with download status:", response.status);
            console.log("URL query with download body:", JSON.stringify(response.body, null, 2));
            expect(response.status).toBe(200);
        });

        test("should access /items/baasix_User with access_token in URL query", async () => {
            const response = await request(app)
                .get(`/items/baasix_User?access_token=${adminToken}`);
            
            console.log("/items with access_token response:", JSON.stringify(response.body, null, 2));
            expect(response.status).toBe(200);
        });

        test("should access /auth/me with access_token in URL query", async () => {
            const response = await request(app)
                .get(`/auth/me?access_token=${adminToken}`);
            
            console.log("/auth/me with access_token status:", response.status);
            console.log("/auth/me with access_token body:", JSON.stringify(response.body, null, 2));
            expect(response.status).toBe(200);
            expect(response.body.user).toBeDefined();
            expect(response.body.role.name).toBe("administrator");
        });
    });

    describe("Access without token", () => {
        test("should fail to access file without token", async () => {
            const response = await request(app)
                .get(`/assets/${fileId}`);
            
            console.log("No token access status:", response.status);
            console.log("No token access body:", JSON.stringify(response.body, null, 2));
            // Should fail with 403 (forbidden) or similar for private file
            expect(response.status).not.toBe(200);
        });
    });
});
