import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

describe("Column-to-Column Comparison Filter Tests", () => {
    beforeAll(async () => {
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;

        // Create test schemas and data
        await setupTestSchemas();
        await setupTestData();
    });

    async function setupTestSchemas() {
        // Create Events schema with start and end times
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "events",
                schema: {
                    name: "Event",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        startTime: { type: "DateTime", allowNull: false },
                        endTime: { type: "DateTime", allowNull: false },
                        status: { type: "String", allowNull: false },
                        priority: { type: "Integer", allowNull: false },
                        maxAttendees: { type: "Integer", allowNull: false },
                        currentAttendees: { type: "Integer", allowNull: false },
                    },
                },
            });

        // Create Projects schema with budget comparisons
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "projects",
                schema: {
                    name: "Project",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        estimatedCost: { type: "Double", allowNull: false },
                        actualCost: { type: "Double", allowNull: false },
                        estimatedHours: { type: "Integer", allowNull: false },
                        actualHours: { type: "Integer", allowNull: false },
                        status: { type: "String", allowNull: false },
                    },
                },
            });
    }

    async function setupTestData() {
        // Create events with various start/end time relationships
        const events = [
            {
                name: "Valid Meeting",
                startTime: "2023-01-01T10:00:00Z",
                endTime: "2023-01-01T11:00:00Z", // endTime > startTime (valid)
                status: "scheduled",
                priority: 5,
                maxAttendees: 50,
                currentAttendees: 30,
            },
            {
                name: "Invalid Meeting",
                startTime: "2023-01-01T14:00:00Z",
                endTime: "2023-01-01T13:00:00Z", // endTime < startTime (invalid)
                status: "error",
                priority: 1,
                maxAttendees: 20,
                currentAttendees: 25, // over capacity
            },
            {
                name: "Same Time Meeting",
                startTime: "2023-01-01T15:00:00Z",
                endTime: "2023-01-01T15:00:00Z", // endTime = startTime
                status: "instant",
                priority: 3,
                maxAttendees: 100,
                currentAttendees: 100, // at capacity
            },
            {
                name: "Long Meeting",
                startTime: "2023-01-01T09:00:00Z",
                endTime: "2023-01-01T17:00:00Z", // 8 hour meeting
                status: "scheduled",
                priority: 2,
                maxAttendees: 10,
                currentAttendees: 5,
            }
        ];

        for (const event of events) {
            await request(app)
                .post("/items/events")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(event);
        }

        // Create projects with budget/hours comparisons
        const projects = [
            {
                name: "Under Budget Project",
                estimatedCost: 100000,
                actualCost: 80000, // actualCost < estimatedCost
                estimatedHours: 1000,
                actualHours: 1200, // actualHours > estimatedHours
                status: "completed",
            },
            {
                name: "Over Budget Project",
                estimatedCost: 50000,
                actualCost: 70000, // actualCost > estimatedCost
                estimatedHours: 500,
                actualHours: 400, // actualHours < estimatedHours
                status: "completed",
            },
            {
                name: "On Budget Project",
                estimatedCost: 75000,
                actualCost: 75000, // actualCost = estimatedCost
                estimatedHours: 750,
                actualHours: 750, // actualHours = estimatedHours
                status: "completed",
            },
        ];

        for (const project of projects) {
            await request(app)
                .post("/items/projects")
                .set("Authorization", `Bearer ${adminToken}`)
                .send(project);
        }
    }

    test("Filter events where startTime > endTime (invalid events)", async () => {
        const response = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    startTime: { gt: "$COL(endTime)" }
                }),
                fields: ["*"],
            });

        console.log("Invalid events (startTime > endTime):", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].name).toBe("Invalid Meeting");
        expect(response.body.data[0].status).toBe("error");
    });

    test("Filter events where endTime > startTime (valid events)", async () => {
        const response = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    endTime: { gt: "$COL(startTime)" }
                }),
                fields: ["*"],
            });

        console.log("Valid events (endTime > startTime):", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2); // Valid Meeting and Long Meeting
        expect(response.body.data.every(event => new Date(event.endTime) > new Date(event.startTime))).toBe(true);
    });

    test("Filter events where startTime = endTime", async () => {
        const response = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    startTime: { eq: "$COL(endTime)" }
                }),
                fields: ["*"],
            });

        console.log("Same time events (startTime = endTime):", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].name).toBe("Same Time Meeting");
        expect(response.body.data[0].status).toBe("instant");
    });

    test("Filter events where currentAttendees > maxAttendees (over capacity)", async () => {
        const response = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    currentAttendees: { gt: "$COL(maxAttendees)" }
                }),
                fields: ["*"],
            });

        console.log("Over capacity events:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].name).toBe("Invalid Meeting");
        expect(response.body.data[0].currentAttendees).toBeGreaterThan(response.body.data[0].maxAttendees);
    });

    test("Filter projects where actualCost > estimatedCost (over budget)", async () => {
        const response = await request(app)
            .get("/items/projects")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    actualCost: { gt: "$COL(estimatedCost)" }
                }),
                fields: ["*"],
            });

        console.log("Over budget projects:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].name).toBe("Over Budget Project");
        expect(response.body.data[0].actualCost).toBeGreaterThan(response.body.data[0].estimatedCost);
    });

    test("Filter projects where actualHours < estimatedHours (under hours)", async () => {
        const response = await request(app)
            .get("/items/projects")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    actualHours: { lt: "$COL(estimatedHours)" }
                }),
                fields: ["*"],
            });

        console.log("Under hours projects:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].name).toBe("Over Budget Project");
        expect(response.body.data[0].actualHours).toBeLessThan(response.body.data[0].estimatedHours);
    });

    test("Complex filter combining column comparisons with regular filters", async () => {
        const response = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    AND: [
                        { endTime: { gt: "$COL(startTime)" } }, // Valid time range
                        { status: { eq: "scheduled" } }, // Only scheduled events
                        { currentAttendees: { lt: "$COL(maxAttendees)" } } // Under capacity
                    ]
                }),
                fields: ["*"],
            });

        console.log("Complex filter results:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2); // Valid Meeting and Long Meeting

        response.body.data.forEach(event => {
            expect(new Date(event.endTime)).toEqual(expect.any(Date));
            expect(new Date(event.startTime)).toEqual(expect.any(Date));
            expect(new Date(event.endTime) > new Date(event.startTime)).toBe(true);
            expect(event.status).toBe("scheduled");
            expect(event.currentAttendees).toBeLessThan(event.maxAttendees);
        });
    });

    test("Column comparison with different operators", async () => {
        // Test >= operator
        const gteResponse = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    currentAttendees: { gte: "$COL(maxAttendees)" }
                }),
                fields: ["*"],
            });

        expect(gteResponse.status).toBe(200);
        expect(gteResponse.body.data).toHaveLength(2); // Invalid Meeting (over) and Same Time Meeting (equal)

        // Test != operator
        const neResponse = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    currentAttendees: { ne: "$COL(maxAttendees)" }
                }),
                fields: ["*"],
            });

        expect(neResponse.status).toBe(200);
        expect(neResponse.body.data).toHaveLength(3); // All except Same Time Meeting
    });

    test("Relational column comparison - employee salary vs department budget", async () => {
        // First create a department-employee relationship to test with
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
                        budget: { type: "Double", allowNull: false },
                        minSalary: { type: "Double", allowNull: false },
                    },
                },
            });

        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "employees",
                schema: {
                    name: "Employee",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        salary: { type: "Double", allowNull: false },
                        bonus: { type: "Double", allowNull: false },
                    },
                },
            });

        // Create relationship: Employee belongs to Department
        await request(app)
            .post("/schemas/employees/relationships")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                type: "M2O",
                target: "departments",
                name: "department",
                alias: "employees",
            });

        // Create test data
        const dept = await request(app)
            .post("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Engineering",
                budget: 100000,
                minSalary: 50000,
            });

        await request(app)
            .post("/items/employees")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "High Earner",
                salary: 80000,
                bonus: 25000, // salary > bonus
                department_id: dept.body.data.id,
            });

        await request(app)
            .post("/items/employees")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Low Earner",
                salary: 40000,
                bonus: 45000, // salary < bonus
                department_id: dept.body.data.id,
            });

        // Test: Find employees where salary > department.minSalary
        const response = await request(app)
            .get("/items/employees")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    salary: { gt: "$COL(department.minSalary)" }
                }),
                fields: ["*", "department.*"],
            });

        console.log("Employees with salary > dept minSalary:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].name).toBe("High Earner");
        expect(response.body.data[0].salary).toBe(80000);
        expect(response.body.data[0].department.minSalary).toBe(50000);

        // Test: Find employees where salary < bonus (compare within same table)
        const bonusResponse = await request(app)
            .get("/items/employees")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    salary: { lt: "$COL(bonus)" }
                }),
                fields: ["*"],
            });

        console.log("Employees with salary < bonus:", JSON.stringify(bonusResponse.body.data, null, 2));

        expect(bonusResponse.status).toBe(200);
        expect(bonusResponse.body.data).toHaveLength(1);
        expect(bonusResponse.body.data[0].name).toBe("Low Earner");
        expect(bonusResponse.body.data[0].salary).toBe(40000);
        expect(bonusResponse.body.data[0].bonus).toBe(45000);
    });

    test("LHS relational column comparison - department budget vs employee salary", async () => {
        // Use the same data from previous test (departments and employees should exist)

        // Test: Find departments where budget > employee salary (using LHS relational path)
        // This tests if we can put a relational field on the LEFT side of the comparison
        const response = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "employees.salary": { "lt": "$COL(budget)" }
                }),
                fields: ["*", "employees.*"],
            });

        console.log("Departments where employee salary < department budget:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);

        const department = response.body.data[0];
        expect(department.name).toBe("Engineering");
        expect(department.budget).toBe(100000);

        // Should have employees with salary less than department budget
        const hasLowSalaryEmployee = department.employees.some(emp => emp.salary < department.budget);
        expect(hasLowSalaryEmployee).toBe(true);

        // Test another pattern: Compare relational field to relational field
        // department.minSalary < employees.salary
        const response2 = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "employees.salary": { "gt": "$COL(minSalary)" }
                }),
                fields: ["*", "employees.*"],
            });

        console.log("Departments with employees earning > minSalary:", JSON.stringify(response2.body.data, null, 2));

        expect(response2.status).toBe(200);
        expect(response2.body.data).toHaveLength(1);

        const dept2 = response2.body.data[0];
        expect(dept2.minSalary).toBe(50000);

        // Should have at least one employee earning more than minSalary
        const hasHighSalaryEmployee = dept2.employees.some(emp => emp.salary > dept2.minSalary);
        expect(hasHighSalaryEmployee).toBe(true);
    });

    test("Complex LHS relational comparisons with nested paths", async () => {
        // Create a more complex nested structure to test multi-level LHS relations
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "companies",
                schema: {
                    name: "Company",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        revenue: { type: "Double", allowNull: false },
                        maxDeptBudget: { type: "Double", allowNull: false },
                    },
                },
            });

        // Create relationship: Department belongs to Company
        await request(app)
            .post("/schemas/departments/relationships")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                type: "M2O",
                target: "companies",
                name: "company",
                alias: "departments",
            });

        // Create test company
        const company = await request(app)
            .post("/items/companies")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "TechCorp",
                revenue: 1000000,
                maxDeptBudget: 120000,
            });

        // Update existing department to belong to this company
        const depts = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`);

        if (depts.body.data.length > 0) {
            await request(app)
                .patch(`/items/departments/${depts.body.data[0].id}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    company_id: company.body.data.id,
                });
        }

        // Test: Companies where department budget < company maxDeptBudget
        // This uses nested LHS relational path: departments.budget
        const response = await request(app)
            .get("/items/companies")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "departments.budget": { "lt": "$COL(maxDeptBudget)" }
                }),
                fields: ["*", "departments.*"],
            });

        console.log("Companies with dept budget < max allowed:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);

        const comp = response.body.data[0];
        expect(comp.maxDeptBudget).toBe(120000);
        expect(comp.departments[0].budget).toBe(100000);
        expect(comp.departments[0].budget).toBeLessThan(comp.maxDeptBudget);
    });

    test("should support PostgreSQL casting syntax in $COL() references", async () => {
        // Test $COL(columnName::castType) syntax
        // This allows casting to be applied directly within the column reference
        const response = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    startTime: { 
                        gt: "$COL(endTime::time)", 
                        cast: "time" 
                    }
                }),
            });

        console.log("Events with PostgreSQL cast syntax in $COL():", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        // Should find events where cast startTime > cast endTime (comparing time parts only)
        response.body.data.forEach(event => {
            const startTime = new Date(event.startTime).getTime();
            const endTime = new Date(event.endTime).getTime();
            expect(startTime).toBeGreaterThan(endTime);
        });
    });

    test("should compare time-cast columns using standard casting approach", async () => {
        // Test standard approach: cast is applied to both left and right sides
        // {"starttime": {"gt": "$COL(endtime)", "cast":"time"}}
        const response = await request(app)
            .get("/items/events")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    startTime: {
                        gt: "$COL(endTime)",
                        cast: "time"
                    }
                }),
            });

        console.log("Events with standard cast approach:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        // Should find events where cast startTime > cast endTime (comparing time parts only)
        response.body.data.forEach(event => {
            const startTime = new Date(event.startTime).getTime();
            const endTime = new Date(event.endTime).getTime();
            expect(startTime).toBeGreaterThan(endTime);
        });
    });

    test("LHS relational column comparison with pagination", async () => {
        // This test verifies that DISTINCT ON works correctly with LIMIT/pagination
        // when filtering on HasMany relations

        // First, verify we have the department with 2 employees from previous tests
        const allDepts = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "employees.salary": { "lt": "$COL(budget)" }
                }),
                fields: ["*", "employees.*"],
            });

        expect(allDepts.status).toBe(200);
        expect(allDepts.body.data).toHaveLength(1);
        expect(allDepts.body.data[0].employees).toHaveLength(2);

        // Now test with pagination - should still return 1 department (not duplicates)
        const response = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "employees.salary": { "lt": "$COL(budget)" }
                }),
                fields: ["*", "employees.*"],
                limit: 10,  // Using limit to trigger pagination
                page: 1,
            });

        console.log("Departments with pagination:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1); // Should still be 1 department, not duplicates

        const department = response.body.data[0];
        expect(department.name).toBe("Engineering");
        expect(department.employees).toHaveLength(2); // Should have both employees

        // Verify both employees satisfy the condition
        department.employees.forEach(emp => {
            expect(emp.salary).toBeLessThan(department.budget);
        });
    });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});