import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

// Test collection names
const castingTestCollection = "castingTest";

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    // Setup test schemas
    await setupCastingTestSchemas();

    // Setup test data
    await setupCastingTestData();
});

afterAll(async () => {
    // Cleanup handled by destroyAllTablesInDB in next test run
});

async function setupCastingTestSchemas() {
    // Create department schema first (for M2O relationship)
    // Use DateTime_NO_TZ for establishedDate to ensure consistent time extraction
    // regardless of server timezone (tests compare against specific time values)
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "departments",
            schema: {
                name: "Department",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    budget: { type: "Decimal", allowNull: true },
                    establishedDate: { type: "DateTime_NO_TZ", allowNull: true },
                    location: { type: "String", allowNull: true },
                    createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    updatedAt: { type: "DateTime", defaultValue: { type: "NOW" } }
                }
            }
        });

    // Create main casting test schema with M2O relationship to department
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: castingTestCollection,
            schema: {
                name: "CastingTest",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    age: { type: "Integer", allowNull: true },
                    salary: { type: "Decimal", allowNull: true },
                    isActive: { type: "Boolean", allowNull: true },
                    createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    updatedAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    birthDate: { type: "Date", allowNull: true },
                    workStartTime: { type: "String", allowNull: true }, // Store as string for time testing
                    metadata: { type: "JSON", allowNull: true },
                    department_id: { type: "UUID", allowNull: true } // Foreign key for M2O
                }
            }
        });

    // Create M2O relationship (castingTest belongs to department)
    await request(app)
        .post(`/schemas/${castingTestCollection}/relationships`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            type: "M2O",
            target: "departments",
            name: "department",
            alias: "employees"
        });
}

async function setupCastingTestData() {
    // Create departments first (for M2O relationship)
    const departmentData = [
        {
            name: "Engineering",
            budget: 500000.00,
            establishedDate: "2020-01-15T09:00:00.000Z",
            location: "Building A"
        },
        {
            name: "Design",
            budget: 200000.00,
            establishedDate: "2021-03-20T14:30:00.000Z",
            location: "Building B"
        }
    ];

    const createdDepartments = [];
    for (const data of departmentData) {
        const response = await request(app)
            .post("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(data);
        createdDepartments.push(response.body.data);
    }

    // Create main test data with department references
    const mainTestData = [
        {
            name: "John Doe",
            age: 30,
            salary: 75000.50,
            isActive: true,
            birthDate: "1993-05-15",
            workStartTime: "09:00:00",
            metadata: { position: "developer", level: "senior" },
            department_id: createdDepartments[0].id // Engineering
        },
        {
            name: "Jane Smith",
            age: 25,
            salary: 65000.00,
            isActive: true,
            birthDate: "1998-09-22",
            workStartTime: "08:30:00",
            metadata: { position: "designer", level: "junior" },
            department_id: createdDepartments[1].id // Design
        },
        {
            name: "Bob Johnson",
            age: 45,
            salary: 95000.75,
            isActive: false,
            birthDate: "1978-12-03",
            workStartTime: "10:00:00",
            metadata: { position: "manager", level: "senior" },
            department_id: createdDepartments[0].id // Engineering
        },
        {
            name: "Alice Brown",
            age: 28,
            salary: 70000.25,
            isActive: true,
            birthDate: "1995-03-18",
            workStartTime: "09:30:00",
            metadata: { position: "analyst", level: "mid" },
            department_id: createdDepartments[1].id // Design
        }
    ];

    for (const data of mainTestData) {
        await request(app)
            .post(`/items/${castingTestCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(data);
    }
}

describe("Casting Tests", () => {
    describe("Time Casting", () => {
        test("should filter by time part of datetime field using equality", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "workStartTime": { "eq": "09:00:00", "cast": "time" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("John Doe");
        });

        test("should filter by time range using between operator", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "workStartTime": {
                            "between": ["08:00:00", "09:30:00"],
                            "cast": "time"
                        }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // John, Jane, Alice
        });

        test("should filter by time using greater than operator", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "workStartTime": { "gt": "09:00:00", "cast": "time" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Bob and Alice
        });

        test("should filter by multiple time values using IN operator", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "workStartTime": {
                            "in": ["09:00:00", "10:00:00"],
                            "cast": "time"
                        }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // John and Bob
        });
    });

    describe("Date Casting", () => {
        test("should filter by date part of datetime field", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "birthDate": { "eq": "1993-05-15", "cast": "date" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("John Doe");
        });

        test("should filter by date range", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "birthDate": {
                            "between": ["1990-01-01", "1996-12-31"],
                            "cast": "date"
                        }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // John and Alice
        });

        test("should filter by year using date casting and greater than", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "birthDate": { "gte": "1995-01-01", "cast": "date" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Jane and Alice
        });
    });

    describe("Text Casting", () => {
        test("should cast integer to text and use LIKE operator", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "age": { "like": "2", "cast": "text" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Jane (25) and Alice (28)
        });

        test("should cast decimal to text and use starts with", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "salary": { "startsWith": "7", "cast": "text" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // John (75000.50) and Alice (70000.25)
        });

        test("should cast boolean to text", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "isActive": { "eq": "true", "cast": "text" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // John, Jane, Alice
        });
    });

    describe("Integer Casting", () => {
        test("should cast text to integer for numeric comparison", async () => {
            // First add a record with string age for testing
            await request(app)
                .post(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Test User",
                    age: "35", // String that should be cast to integer
                    salary: 80000.00,
                    isActive: true,
                    birthDate: "1988-01-01",
                    workStartTime: "09:00:00"
                });

            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "age": { "gt": 30, "cast": "integer" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1); // At least Test User (35) or Bob (45)

            // Verify we have people over 30
            const over30 = response.body.data.filter(person => person.age > 30);
            expect(over30.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("Relational Casting Tests", () => {
        test("should filter by M2O relation with date casting", async () => {
            // Test M2O (BelongsTo) relation filtering with casting
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "department.establishedDate": {
                            "eq": "2020-01-15", // Cast datetime to date for comparison
                            "cast": "date"
                        }
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees in Engineering department (established 2020-01-15)
            const engineeringEmployees = response.body.data.filter(emp => emp.department?.name === "Engineering");
            expect(engineeringEmployees.length).toBeGreaterThanOrEqual(1);
        });

        test("should filter by M2O relation with time casting from datetime", async () => {
            // Test extracting time part from department's establishedDate
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "department.establishedDate": {
                            "eq": "14:30:00", // Cast datetime to time for comparison
                            "cast": "time"
                        }
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees in Design department (established at 14:30:00)
            const designEmployees = response.body.data.filter(emp => emp.department?.name === "Design");
            expect(designEmployees.length).toBeGreaterThanOrEqual(1);
        });

        test("should filter by M2O relation with text casting", async () => {
            // Test casting department budget to text for LIKE operations
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "department.budget": {
                            "like": "500000", // Cast decimal to text for pattern matching
                            "cast": "text"
                        }
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees in Engineering department (budget 500000.00)
            const engineeringEmployees = response.body.data.filter(emp => emp.department?.name === "Engineering");
            expect(engineeringEmployees.length).toBeGreaterThanOrEqual(1);
        });

        test("should filter by M2O relation with text casting using startsWith", async () => {
            // Test using startsWith operator with text casting
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "department.location": {
                            "startsWith": "Building", // Cast to text and use startsWith
                            "cast": "text"
                        }
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees in departments with locations starting with "Building"
            expect(response.body.data.every(emp => 
                emp.department?.location?.startsWith("Building")
            )).toBe(true);
        });

        test("should filter by M2O relation with date range casting", async () => {
            // Test using between operator with date casting
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "department.establishedDate": {
                            "between": ["2020-01-01", "2020-12-31"], // Cast datetime to date for range
                            "cast": "date"
                        }
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees in Engineering department (established in 2020)
            const engineeringEmployees = response.body.data.filter(emp => emp.department?.name === "Engineering");
            expect(engineeringEmployees.length).toBeGreaterThanOrEqual(1);
        });

        test("should filter by M2O relation with integer casting", async () => {
            // Test casting budget to integer for numeric comparison
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "department.budget": {
                            "gt": 300000, // Cast decimal to integer for comparison
                            "cast": "integer"
                        }
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees in Engineering department (budget > 300000)
            const highBudgetEmployees = response.body.data.filter(emp => 
                emp.department && parseFloat(emp.department.budget) > 300000
            );
            expect(highBudgetEmployees.length).toBeGreaterThanOrEqual(1);
        });

        test("should filter by M2O relation with multiple cast conditions", async () => {
            // Test combining multiple M2O cast conditions
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "AND": [
                            {
                                "department.establishedDate": {
                                    "gte": "2020-01-01", // Cast datetime to date
                                    "cast": "date"
                                }
                            },
                            {
                                "department.budget": {
                                    "gte": 200000, // Cast decimal to integer
                                    "cast": "integer"
                                }
                            }
                        ]
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees in departments established after 2020 with budget >= 200000
            expect(response.body.data.every(emp => 
                emp.department && 
                new Date(emp.department.establishedDate).getFullYear() >= 2020 &&
                parseFloat(emp.department.budget) >= 200000
            )).toBe(true);
        });

        test("should combine M2O relation casting with direct field casting", async () => {
            // Test combining relational and direct field casting
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "AND": [
                            {
                                "department.establishedDate": {
                                    "eq": "09:00:00", // Cast department datetime to time
                                    "cast": "time"
                                }
                            },
                            {
                                "age": {
                                    "like": "3", // Cast employee age to text
                                    "cast": "text"
                                }
                            }
                        ]
                    }),
                    fields: ["*", "department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
            // Should find employees with age containing "3" in Engineering dept (established at 09:00:00)
            const matchingEmployees = response.body.data.filter(emp => 
                emp.department?.name === "Engineering" && 
                emp.age.toString().includes("3")
            );
            expect(matchingEmployees.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("Additional Casting Tests", () => {
        test("should work with NULL values when casting", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "birthDate": {
                            "isNotNull": true,
                            "cast": "date"
                        }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        });

        test("should work with case insensitive text casting", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "name": {
                            "iLike": "john doe",
                            "cast": "text"
                        }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("John Doe");
        });

        test("should handle edge case with empty string cast", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "name": {
                            "ne": "",
                            "cast": "text"
                        }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(4); // All our test users
        });
    });

    describe("Error Handling", () => {
        test("should handle invalid cast type gracefully", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "name": { "eq": "John Doe", "cast": "invalid_type" }
                    })
                });

            // Should still work, just without casting
            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("John Doe");
        });

        test("should handle missing cast value", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "name": { "eq": "John Doe", "cast": "" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("John Doe");
        });

        test("should handle null cast value", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "name": { "eq": "John Doe", "cast": null }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("John Doe");
        });
    });

    describe("Complex Casting Scenarios", () => {
        test("should combine multiple cast operations with AND", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "AND": [
                            { "workStartTime": { "lt": "10:00:00", "cast": "time" } },
                            { "age": { "like": "3", "cast": "text" } }
                        ]
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // John (30 years, 09:00:00) and Test User (35, 09:00:00)
            // Verify both have ages containing "3"
            expect(response.body.data.every(person => person.age.toString().includes("3"))).toBe(true);
        });

        test("should combine multiple cast operations with OR", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "OR": [
                            { "workStartTime": { "eq": "08:30:00", "cast": "time" } },
                            { "age": { "eq": "45", "cast": "text" } }
                        ]
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Jane and Bob
        });

        test("should work with cast and regular operators together", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "AND": [
                            { "workStartTime": { "gte": "09:00:00", "cast": "time" } },
                            { "isActive": { "eq": true } }  // No cast
                        ]
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // John, Alice, and Test User
            // Verify all are active
            expect(response.body.data.every(person => person.isActive === true)).toBe(true);
        });
    });

    describe("All Supported Cast Types", () => {
        test("should work with varchar cast type", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "age": { "eq": "30", "cast": "varchar" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
        });

        test("should work with bigint cast type", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "age": { "eq": "30", "cast": "bigint" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
        });

        test("should work with decimal cast type", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "age": { "gt": "29.5", "cast": "decimal" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(2);
        });

        test("should work with timestamp cast type", async () => {
            const response = await request(app)
                .get(`/items/${castingTestCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "birthDate": { "like": "1993-05", "cast": "text" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
        });
    });
});