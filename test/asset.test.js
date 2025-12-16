import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import path from "path";
//import { fileURLToPath } from "url";
import sharp from "sharp";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

let app;
let adminToken;
let testFileId;

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Log in as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    // Upload a test file
    const testFilePath = path.join(__dirname, "test-assets", "test-image.jpg");
    const uploadResponse = await request(app)
        .post("/files")
        .set("Authorization", `Bearer ${adminToken}`)
        .attach("file", testFilePath);

    testFileId = uploadResponse.body.data;
});

describe("Asset Service", () => {
    test("Get asset URL and verify content", async () => {
        // Get file details
        const fileResponse = await request(app)
            .get(`/files/${testFileId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(fileResponse.status).toBe(200);
        expect(fileResponse.body.data).toHaveProperty("id", testFileId);

        // Get asset
        const assetResponse = await request(app)
            .get(`/assets/${testFileId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers["content-type"]).toBe("image/jpeg");

        // Verify content (basic check)
        expect(assetResponse.body).toBeInstanceOf(Buffer);
        expect(assetResponse.body.length).toBeGreaterThan(0);
    });

    test("Get resized asset", async () => {
        const response = await request(app)
            .get(`/assets/${testFileId}?width=300&height=200`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("image/jpeg");

        // Verify the image is resized
        const resizedImage = await sharp(response.body).metadata();
        expect(resizedImage.width).toBe(300);
        expect(resizedImage.height).toBe(200);
    });

    test("Get asset with different quality", async () => {
        const response = await request(app)
            .get(`/assets/${testFileId}?quality=50`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("image/jpeg");

        // Verify the image has lower quality (smaller file size)
        const originalResponse = await request(app)
            .get(`/assets/${testFileId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.body.length).toBeLessThan(originalResponse.body.length);
    });

    test("Get non-existent asset", async () => {
        const response = await request(app).get(`/assets/non-existent-id`).set("Authorization", `Bearer ${adminToken}`);
        console.log("non-existent", response.body);

        expect(response.status).toBe(500);
    });

    test("Get asset without authentication", async () => {
        const response = await request(app).get(`/assets/${testFileId}`);
        console.log("without authentication", response.body);

        expect(response.status).toBe(403);
    });
});

afterAll(async () => {
    // Clean up: delete the test file
    await request(app).delete(`/files/${testFileId}`).set("Authorization", `Bearer ${adminToken}`);
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
