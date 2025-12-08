import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create test schemas with PostGIS fields
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "locations",
            schema: {
                name: "Location",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    point: { type: "Point", allowNull: false },
                },
            },
        });

    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "areas",
            schema: {
                name: "Area",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    polygon: { type: "Polygon", allowNull: false },
                },
            },
        });

    // Create test data
    await request(app)
        .post("/items/locations")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Central Park",
            point: { type: "Point", coordinates: [-73.9654, 40.7829] },
        });

    await request(app)
        .post("/items/locations")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Statue of Liberty",
            point: { type: "Point", coordinates: [-74.0445, 40.6892] },
        });

    await request(app)
        .post("/items/areas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Manhattan",
            polygon: {
                type: "Polygon",
                coordinates: [
                    [
                        [-74.0479, 40.6829],
                        [-73.9067, 40.6829],
                        [-73.9067, 40.8789],
                        [-74.0479, 40.8789],
                        [-74.0479, 40.6829],
                    ],
                ],
            },
        });

    await request(app)
        .post("/items/areas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Central Park Area",
            polygon: {
                type: "Polygon",
                coordinates: [
                    [
                        [-73.9814, 40.7681],
                        [-73.9497, 40.7681],
                        [-73.9497, 40.7965],
                        [-73.9814, 40.7965],
                        [-73.9814, 40.7681],
                    ],
                ],
            },
        });
});

describe("PostGIS Spatial Queries", () => {
    test("Find Areas Containing Point", async () => {
        const centralParkPoint = [-73.9654, 40.7829]; // Central Park coordinates

        const response = await request(app)
            .get("/items/areas")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "polygon": {
                        containsGEO: {
                            type: "Point",
                            coordinates: centralParkPoint,
                        },
                    },
                }),
            });

        console.log("Find Areas Containing Point response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2); // Should be in both Manhattan and Central Park Area
        expect(response.body.data.some((area) => area.name === "Manhattan")).toBe(true);
        expect(response.body.data.some((area) => area.name === "Central Park Area")).toBe(true);
    });

    test("Point within Polygon", async () => {
        const response = await request(app)
            .get("/items/locations")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "point": {
                        within: {
                            type: "Polygon",
                            coordinates: [
                                [
                                    [-73.9814, 40.7681],
                                    [-73.9497, 40.7681],
                                    [-73.9497, 40.7965],
                                    [-73.9814, 40.7965],
                                    [-73.9814, 40.7681],
                                ],
                            ],
                        },
                    },
                }),
            });

        console.log("Response data:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].name).toBe("Central Park");
    });

    test("Distance Greater Than", async () => {
        const response = await request(app)
            .get("/items/locations")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "point": {
                        dwithin: {
                            geometry: {
                                type: "Point",
                                coordinates: [-74.006, 40.7128], // New York City center
                            },
                            distance: 8000, // 8 km in meters
                        },
                    },
                }),
            });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].name).toBe("Statue of Liberty");
    });

    test("Sort by Distance", async () => {
        const response = await request(app)
            .get("/items/locations")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                sort: JSON.stringify({
                    _distance: {
                        target: [-74.006, 40.7128], // New York City center
                        column: "point",
                        direction: "DESC", // Sort from nearest to farthest
                    },
                }),
            });

        console.log("Sort by Distance response:", response.body);

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data[0].name).toBe("Central Park");
        expect(response.body.data[1].name).toBe("Statue of Liberty");
    });

    test("Sort by Distance (Reverse)", async () => {
        const response = await request(app)
            .get("/items/locations")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                sort: JSON.stringify({
                    _distance: {
                        target: [-74.006, 40.7128], // New York City center
                        column: "point",
                        direction: "ASC", // Sort from farthest to nearest
                    },
                }),
            });

        console.log("Sort by Distance (Reverse) response:", JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(2);
        expect(response.body.data[0].name).toBe("Statue of Liberty");
        expect(response.body.data[1].name).toBe("Central Park");
    });

    test("Intersects Query", async () => {
        const response = await request(app)
            .get("/items/locations")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "point": {
                        intersects: {
                            type: "Polygon",
                            coordinates: [
                                [
                                    [-73.9814, 40.7681],
                                    [-73.9497, 40.7681],
                                    [-73.9497, 40.7965],
                                    [-73.9814, 40.7965],
                                    [-73.9814, 40.7681],
                                ],
                            ],
                        },
                    },
                }),
            });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].name).toBe("Central Park");
    });

    test("Buffer Query", async () => {
        const response = await request(app)
            .get("/items/locations")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "point": {
                        dwithin: {
                            geometry: {
                                type: "Point",
                                coordinates: [-73.9654, 40.7829], // Central Park coordinates
                            },
                            distance: 1000, // 1 km buffer
                        },
                    },
                }),
            });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].name).toBe("Central Park");
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
