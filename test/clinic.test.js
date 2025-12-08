import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

describe("Nested Relations with RelConditions and Filter Test", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;

        // Create test schemas and relationships
        await setupTestSchemas();

        // Create test data
        await setupTestData();
    });

    async function setupTestSchemas() {
        try {
            // Create Clinic schema
            await request(app)
                .post("/schemas")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    collectionName: "clinics",
                    schema: {
                        name: "Clinic",
                        fields: {
                            id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                            name: { type: "String", allowNull: false },
                            address: { type: "String", allowNull: true },
                            status: { type: "String", allowNull: false, defaultValue: "active" },
                        },
                    },
                });

            // Create OperationTheatre schema
            await request(app)
                .post("/schemas")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    collectionName: "operationtheatres",
                    schema: {
                        name: "OperationTheatre",
                        fields: {
                            id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                            name: { type: "String", allowNull: false },
                            capacity: { type: "Integer", allowNull: false },
                            status: { type: "String", allowNull: false, defaultValue: "active" },
                        },
                    },
                });

            // Create OperationTheatreUsage schema
            await request(app)
                .post("/schemas")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    collectionName: "operationtheatreusage",
                    schema: {
                        name: "OperationTheatreUsage",
                        fields: {
                            id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                            date: { type: "Date", allowNull: false },
                            startTime: { type: "String", allowNull: false },
                            endTime: { type: "String", allowNull: false },
                            patientName: { type: "String", allowNull: true },
                            notes: { type: "String", allowNull: true },
                        },
                        paranoid: true,
                    },
                });

            // Create relation between OperationTheatre and Clinic
            await request(app)
                .post("/schemas/operationtheatres/relationships")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "M2O",
                    target: "clinics",
                    name: "clinic",
                    alias: "operationtheatres",
                });

            // Create relation between OperationTheatreUsage and OperationTheatre
            await request(app)
                .post("/schemas/operationtheatreusage/relationships")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "M2O",
                    target: "operationtheatres",
                    name: "operationtheatre",
                    alias: "operationtheatreusage",
                });

            console.log("Schemas and relationships set up successfully");
        } catch (error) {
            console.error("Error setting up test schemas:", error);
            throw error;
        }
    }

    async function setupTestData() {
        try {
            // Create clinics
            const clinic1 = await request(app)
                .post("/items/clinics")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "City Hospital",
                    address: "123 Main St, City",
                    status: "active",
                });

            const clinic2 = await request(app)
                .post("/items/clinics")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Rural Medical Center",
                    address: "456 Country Rd, Rural",
                    status: "active",
                });

            // Create operation theatres
            const theatre1 = await request(app)
                .post("/items/operationtheatres")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Theatre A",
                    capacity: 10,
                    status: "active",
                    clinic_id: clinic1.body.data.id,
                });

            const theatre2 = await request(app)
                .post("/items/operationtheatres")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Theatre B",
                    capacity: 15,
                    status: "active",
                    clinic_id: clinic1.body.data.id,
                });

            const theatre3 = await request(app)
                .post("/items/operationtheatres")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Main Theatre",
                    capacity: 20,
                    status: "active",
                    clinic_id: clinic2.body.data.id,
                });

            // Create usage records for multiple dates
            await request(app).post("/items/operationtheatreusage").set("Authorization", `Bearer ${adminToken}`).send({
                date: "2025-02-27",
                startTime: "09:00",
                endTime: "11:00",
                patientName: "Patient 1",
                operationtheatre_id: theatre1.body.data.id,
            });

            await request(app).post("/items/operationtheatreusage").set("Authorization", `Bearer ${adminToken}`).send({
                date: "2025-02-27",
                startTime: "14:00",
                endTime: "16:00",
                patientName: "Patient 2",
                operationtheatre_id: theatre3.body.data.id,
            });

            await request(app).post("/items/operationtheatreusage").set("Authorization", `Bearer ${adminToken}`).send({
                date: "2024-12-01",
                startTime: "09:00",
                endTime: "11:00",
                patientName: "Patient 3",
                operationtheatre_id: theatre1.body.data.id,
            });

            await request(app).post("/items/operationtheatreusage").set("Authorization", `Bearer ${adminToken}`).send({
                date: "2024-12-01",
                startTime: "13:00",
                endTime: "15:00",
                patientName: "Patient 4",
                operationtheatre_id: theatre2.body.data.id,
            });
        } catch (error) {
            console.error("Error setting up test data:", error);
            throw error;
        }
    }

    test("Complex query with nested relations, filter, and relConditions", async () => {
        try {
            console.log("Running test with relConditions...");

            const response = await request(app)
                .get("/items/clinics")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    fields: ["*", "operationtheatres.*", "operationtheatres.operationtheatreusage.*"],
                    filter: JSON.stringify({
                        "operationtheatres.operationtheatreusage.date": { eq: "2024-12-01" },
                    }),
                    relConditions: JSON.stringify({
                        operationtheatres: {
                            operationtheatreusage: {
                                date: { eq: "2025-02-27" },
                            },
                        },
                    }),
                    limit: 24,
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toBeDefined();

            // Log the response for debugging
            console.log("Response data:", JSON.stringify(response.body.data, null, 2));

            // Verify data structure and content
            expect(response.body.data.length).toBeGreaterThan(0);
            expect(response.body.data[0].operationtheatres).toBeDefined();

            // Verify that we get the clinic that has theatres with usage on both dates
            const clinic = response.body.data[0];
            expect(clinic.name).toBe("City Hospital");

            // Verify that the operationtheatres have the correct filtered usage dates based on relConditions
            let hasTheatresWithCorrectUsageDates = false;
            for (const theatre of clinic.operationtheatres) {
                // Check that only usage records for 2025-02-27 are included
                if (theatre.operationtheatreusage && theatre.operationtheatreusage.length > 0) {
                    const allUsagesHaveCorrectDate = theatre.operationtheatreusage.every(
                        (usage) => usage.date === "2025-02-27"
                    );

                    if (allUsagesHaveCorrectDate && theatre.operationtheatreusage.length > 0) {
                        hasTheatresWithCorrectUsageDates = true;
                        break;
                    }
                }
            }

            expect(hasTheatresWithCorrectUsageDates).toBe(true);

            // Verify that no usage records with date 2024-12-01 are present in the response
            let hasUsagesWith2024Date = false;
            for (const theatre of clinic.operationtheatres) {
                if (
                    theatre.operationtheatreusage &&
                    theatre.operationtheatreusage.some((usage) => usage.date === "2024-12-01")
                ) {
                    hasUsagesWith2024Date = true;
                    break;
                }
            }

            expect(hasUsagesWith2024Date).toBe(false);
        } catch (error) {
            console.error("Test error:", error);
            throw error;
        }
    });

    afterAll(async () => {
        if (app.server) {
            await new Promise((resolve) => app.server.close(resolve));
        }
    });
});
