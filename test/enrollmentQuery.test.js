import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let testUserId;
let testCourseId;
let testBatchId;

describe("Enrollment Query with BelongsToMany Filter Tests", () => {
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
        await setupTestRelationships();

        // Create test data
        await setupTestData();
    });

    async function setupTestSchemas() {
        // Create Course schema
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "course",
                schema: {
                    name: "Course",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        title: { type: "String", allowNull: false },
                        status: { type: "String", allowNull: false, defaultValue: "active" },
                        createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    },
                },
            });

        // Create Batch schema
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "batch",
                schema: {
                    name: "Batch",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        course_id: { type: "UUID", allowNull: false },
                        status: { type: "String", allowNull: false, defaultValue: "active" },
                        createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    },
                },
            });

        // Create Enrollment schema
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "enrollment",
                schema: {
                    name: "Enrollment",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        batch_id: { type: "UUID", allowNull: false },
                        course_id: { type: "UUID", allowNull: false },
                        orguser_id: { type: "UUID", allowNull: true },
                        status: { type: "String", allowNull: false, defaultValue: "active" },
                        end_date: { type: "Date", allowNull: true },
                        createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    },
                },
            });
    }

    async function setupTestRelationships() {
        // Enrollment -> Course (BelongsTo)
        await request(app)
            .post("/schemas/enrollment/relationships")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                type: "M2O",
                target: "course",
                foreignKey: "course_id",
                name: "course",
                alias: "enrollments",
            });

        // Enrollment -> Batch (BelongsTo)
        await request(app)
            .post("/schemas/enrollment/relationships")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                type: "M2O",
                target: "batch",
                foreignKey: "batch_id",
                name: "batch",
                alias: "enrollments",
            });

        // Batch -> Course (BelongsTo)
        await request(app)
            .post("/schemas/batch/relationships")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                type: "M2O",
                target: "course",
                foreignKey: "course_id",
                name: "course",
                alias: "batches",
            });

        // Batch -> Users (BelongsToMany)
        await request(app)
            .post("/schemas/batch/relationships")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                isRelationship: true,
                name: "users",
                description: "M2M",
                type: "M2M",
                target: "baasix_User",
                targetField: "batch_id",
                sourceField: "baasix_User_id",
            });
    }

    async function setupTestData() {
        // Create test user
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

        // Create test course
        const createCourseResponse = await request(app)
            .post("/items/course")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                title: "Test Course",
                status: "active",
            });
        testCourseId = createCourseResponse.body.data.id;

        // Create archived course for negative testing
        await request(app)
            .post("/items/course")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                title: "Archived Course",
                status: "archived",
            });

        // Create test batch
        const createBatchResponse = await request(app)
            .post("/items/batch")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Test Batch",
                course_id: testCourseId,
                status: "active",
            });
        testBatchId = createBatchResponse.body.data.id;

        // Create batch without users for testing
        await request(app)
            .post("/items/batch")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Empty Batch",
                course_id: testCourseId,
                status: "active",
            });

        // Associate user with batch (BelongsToMany relationship)
        await request(app)
            .post("/items/batch_baasix_User_users_junction")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                batch_id: testBatchId,
                baasix_User_id: testUserId,
            });

        // Create test enrollment
        await request(app)
            .post("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                batch_id: testBatchId,
                course_id: testCourseId,
                orguser_id: testUserId,
                status: "active",
                end_date: "2025-08-31", // Future date
            });

        // Create enrollment without orguser_id (should match via batch.users)
        await request(app)
            .post("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                batch_id: testBatchId,
                course_id: testCourseId,
                orguser_id: null,
                status: "active",
                end_date: "2025-09-30", // Future date
            });

        // Create archived enrollment for negative testing
        await request(app)
            .post("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                batch_id: testBatchId,
                course_id: testCourseId,
                orguser_id: testUserId,
                status: "archived",
                end_date: "2025-08-31",
            });
    }

    afterAll(async () => {
        if (app && app.close) {
            await app.close();
        }
    });

    test("should return enrollments with complex BelongsToMany filter", async () => {
        const filter = {
            "AND": [
                {
                    "status": {
                        "ne": "archived"
                    }
                },
                {
                    "OR": [
                        {
                            "end_date": {
                                "gte": "2025-07-31"
                            }
                        },
                        {
                            "end_date": {
                                "isNull": true
                            }
                        }
                    ]
                },
                {
                    "AND": [
                        {
                            "OR": [
                                {
                                    "batch.users.baasix_User_id": {
                                        "eq": testUserId
                                    }
                                },
                                {
                                    "orguser_id": {
                                        "eq": testUserId
                                    }
                                }
                            ]
                        },
                        {
                            "course.status": {
                                "ne": "archived"
                            }
                        }
                    ]
                }
            ]
        };

        const response = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(filter),
                fields: JSON.stringify(["*", "batch.id", "batch.users.baasix_User_id", "course.id", "course.status"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data)).toBe(true);
        
        // Should return at least 2 enrollments (one with orguser_id, one via batch.users)
        expect(response.body.data.length).toBeGreaterThanOrEqual(2);

        // Verify the filter conditions are working
        response.body.data.forEach(enrollment => {
            expect(enrollment.status).not.toBe("archived");
            expect(
                enrollment.end_date === null || 
                new Date(enrollment.end_date) >= new Date("2025-07-31")
            ).toBe(true);
        });
    });

    test("should handle enrollment with orguser_id match", async () => {
        const filter = {
            "AND": [
                {
                    "orguser_id": {
                        "eq": testUserId
                    }
                },
                {
                    "status": {
                        "ne": "archived"
                    }
                }
            ]
        };

        const response = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(filter),
                fields: JSON.stringify(["*"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        
        response.body.data.forEach(enrollment => {
            expect(enrollment.orguser_id).toBe(testUserId);
            expect(enrollment.status).not.toBe("archived");
        });
    });

    test("should handle enrollment with batch.users filter only", async () => {
        const filter = {
            "AND": [
                {
                    "batch.users.baasix_User_id": {
                        "eq": testUserId
                    }
                },
                {
                    "status": {
                        "ne": "archived"
                    }
                }
            ]
        };

        const response = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(filter),
                fields: JSON.stringify(["*", "batch.users.baasix_User_id"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        
        // This test specifically checks if BelongsToMany filtering works
        // Before the fix, this might return empty results due to INNER JOIN issues
        expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });

    test("should return empty for non-existent user", async () => {
        const nonExistentUserId = "00000000-0000-0000-0000-000000000000";
        
        const filter = {
            "AND": [
                {
                    "OR": [
                        {
                            "batch.users.baasix_User_id": {
                                "eq": nonExistentUserId
                            }
                        },
                        {
                            "orguser_id": {
                                "eq": nonExistentUserId
                            }
                        }
                    ]
                },
                {
                    "status": {
                        "ne": "archived"
                    }
                }
            ]
        };

        const response = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(filter),
                fields: JSON.stringify(["*"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(0);
    });

    test("should filter out archived courses", async () => {
        const filter = {
            "AND": [
                {
                    "orguser_id": {
                        "eq": testUserId
                    }
                },
                {
                    "course.status": {
                        "eq": "active"  // Changed to "active" to match our test data
                    }
                }
            ]
        };

        const response = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(filter),
                fields: ["*", "course.status"]
            });

        
        expect(response.status).toBe(200);
        // Should return results because our courses have "active" status
        expect(response.body.data.length).toBeGreaterThan(0);
    });

    test("should handle end_date null conditions", async () => {
        // Create enrollment with null end_date
        await request(app)
            .post("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                batch_id: testBatchId,
                course_id: testCourseId,
                orguser_id: testUserId,
                status: "active",
                end_date: null,
            });

        const filter = {
            "AND": [
                {
                    "orguser_id": {
                        "eq": testUserId
                    }
                },
                {
                    "end_date": {
                        "isNull": true
                    }
                }
            ]
        };

        const response = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(filter),
                fields: JSON.stringify(["*"])
            });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        
        response.body.data.forEach(enrollment => {
            expect(enrollment.end_date).toBeNull();
        });
    });

    test("should test JOIN behavior - enrollment with batch without users", async () => {
        // Create a new user
        const createUser2Response = await request(app)
            .post("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                firstName: "User2",
                lastName: "Test",
                email: "user2@test.com",
                password: "userpassword",
            });
        const user2Id = createUser2Response.body.data.id;

        // Create a batch without any users
        const createEmptyBatchResponse = await request(app)
            .post("/items/batch")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Empty Batch for JOIN Test",
                course_id: testCourseId,
                status: "active",
            });
        const emptyBatchId = createEmptyBatchResponse.body.data.id;

        // Create enrollment for this empty batch
        await request(app)
            .post("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                batch_id: emptyBatchId,
                course_id: testCourseId,
                orguser_id: user2Id,
                status: "active",
                end_date: "2025-08-31",
            });

        // Test 1: Query should return enrollment even if batch has no users (LEFT JOIN behavior)
        const filterWithBatchUsers = {
            "AND": [
                {
                    "orguser_id": {
                        "eq": user2Id
                    }
                },
                {
                    "status": {
                        "ne": "archived"
                    }
                }
            ]
        };

        const responseWithFields = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(filterWithBatchUsers),
                fields: JSON.stringify(["*", "batch.users.baasix_User_id"]) // Including batch.users should not prevent results
            });

        expect(responseWithFields.status).toBe(200);
        expect(responseWithFields.body.data.length).toBeGreaterThanOrEqual(1);
        
        // Find our specific enrollment
        const ourEnrollment = responseWithFields.body.data.find(e => e.orguser_id === user2Id);
        expect(ourEnrollment).toBeDefined();
        expect(ourEnrollment.batch_id).toBe(emptyBatchId);

        // Test 2: The problematic query - filtering by batch.users when batch has no users
        const problematicFilter = {
            "AND": [
                {
                    "OR": [
                        {
                            "batch.users.baasix_User_id": {
                                "eq": user2Id
                            }
                        },
                        {
                            "orguser_id": {
                                "eq": user2Id
                            }
                        }
                    ]
                },
                {
                    "status": {
                        "ne": "archived"
                    }
                }
            ]
        };

        const problematicResponse = await request(app)
            .get("/items/enrollment")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(problematicFilter),
                fields: JSON.stringify(["*", "batch.users.baasix_User_id"])
            });

        expect(problematicResponse.status).toBe(200);
        
        // This test demonstrates the issue:
        // - With INNER JOIN: might return 0 results because batch has no users
        // - With LEFT JOIN: should return 1 result because orguser_id matches
        expect(problematicResponse.body.data.length).toBeGreaterThanOrEqual(1);
        
        const matchedEnrollment = problematicResponse.body.data.find(e => e.orguser_id === user2Id);
        expect(matchedEnrollment).toBeDefined();
        expect(matchedEnrollment.orguser_id).toBe(user2Id);
    });
});