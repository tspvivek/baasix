import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import path from "path";
import { fileURLToPath } from "url";
import { beforeAll, test, expect, describe, afterAll } from "@jest/globals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
});

describe("File Service", () => {
    test("Upload a file", async () => {
        const testFilePath = path.join(__dirname, "test-assets", "test-image.jpg");
        const response = await request(app)
            .post("/files")
            .set("Authorization", `Bearer ${adminToken}`)
            .attach("file", testFilePath);

        expect(response.status).toBe(200); // Changed from 201 to 200
        expect(response.body).toHaveProperty("data");

        testFileId = response.body.data;
    });

    test("Get file details", async () => {
        const response = await request(app).get(`/files/${testFileId}`).set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveProperty("id", testFileId);
        expect(response.body.data).toHaveProperty("filename");
        expect(response.body.data).toHaveProperty("type");
        expect(response.body.data).toHaveProperty("size");
    });

    test("Update file metadata", async () => {
        const newMetadata = {
            title: "Updated Test Image",
            description: "This is an updated test image",
        };

        const response = await request(app)
            .patch(`/files/${testFileId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(newMetadata);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("data", testFileId);
    });

    test("Upload file from URL", async () => {
        const fileUrl = "https://www.gstatic.com/webp/gallery3/1.png";
        const response = await request(app)
            .post("/files/upload-from-url")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ url: fileUrl });

        console.log("upload-from-url", response.body);

        expect(response.status).toBe(200); // Changed from 201 to 200
        expect(response.body).toHaveProperty("data");
    });

    test("Delete a file", async () => {
        const response = await request(app).delete(`/files/${testFileId}`).set("Authorization", `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("message", "File deleted successfully");

        // Verify the file is no longer accessible
        const getResponse = await request(app).get(`/files/${testFileId}`).set("Authorization", `Bearer ${adminToken}`);

        expect(getResponse.status).toBe(403);
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
