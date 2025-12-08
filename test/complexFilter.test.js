import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

describe("Complex Filter Tests", () => {
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
        // Create Department schema
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
                        status: { type: "String", allowNull: false },
                        createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                    },
                },
            });

        // Create Employee schema
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "employees",
                schema: {
                    name: "Employee",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        firstName: { type: "String", allowNull: false },
                        lastName: { type: "String", allowNull: false },
                        salary: { type: "Double", allowNull: false },
                        hireDate: { type: "DateTime", defaultValue: { type: "NOW" } },
                        status: { type: "String", allowNull: false },
                    },
                },
            });

        // Create Project schema
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
                        budget: { type: "Double", allowNull: false },
                        status: { type: "String", allowNull: false },
                        startDate: { type: "DateTime", defaultValue: { type: "NOW" } },
                        endDate: { type: "DateTime", allowNull: true },
                    },
                },
            });
    }

    async function setupTestRelationships() {
        // 1. Department has many Employees
        await request(app).post("/schemas/employees/relationships").set("Authorization", `Bearer ${adminToken}`).send({
            type: "M2O", // Many employees to One department
            target: "departments",
            //foreignKey: "departmentId",
            name: "department", // This is the field in Employee model
            alias: "employees", // This will create the reverse relationship in Department model
        });

        // 2. Employee can have one manager (self-referential)
        await request(app).post("/schemas/employees/relationships").set("Authorization", `Bearer ${adminToken}`).send({
            type: "M2O",
            target: "employees",
            //foreignKey: "managerId",
            name: "manager",
            alias: "subordinates",
        });

        // 3. Department has many Projects
        await request(app).post("/schemas/projects/relationships").set("Authorization", `Bearer ${adminToken}`).send({
            type: "M2O", // Many projects to One department
            target: "departments",
            //foreignKey: "departmentId",
            name: "department",
            alias: "projects",
        });

        // 4. Project has one lead (Employee)
        await request(app).post("/schemas/projects/relationships").set("Authorization", `Bearer ${adminToken}`).send({
            type: "M2O",
            target: "employees",
            //foreignKey: "leadId",
            name: "lead",
            alias: "ledProjects",
        });
    }

    async function setupTestData() {
        // Create departments
        const dept1 = await request(app).post("/items/departments").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Engineering",
            budget: 1000000,
            status: "active",
        });

        const dept2 = await request(app).post("/items/departments").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Marketing",
            budget: 500000,
            status: "inactive",
        });

        // Create employees
        const manager1 = await request(app).post("/items/employees").set("Authorization", `Bearer ${adminToken}`).send({
            firstName: "John",
            lastName: "Manager",
            salary: 100000,
            status: "active",
            hireDate: "2022-01-01",
            department_id: dept1.body.data.id,
        });

        const manager2 = await request(app).post("/items/employees").set("Authorization", `Bearer ${adminToken}`).send({
            firstName: "Jane",
            lastName: "Director",
            salary: 120000,
            status: "active",
            hireDate: "2022-02-01",
            department_id: dept2.body.data.id,
        });

        // Create regular employees
        await request(app).post("/items/employees").set("Authorization", `Bearer ${adminToken}`).send({
            firstName: "Alice",
            lastName: "Engineer",
            salary: 80000,
            status: "active",
            hireDate: "2023-02-15",
            department_id: dept1.body.data.id,
            manager_id: manager1.body.data.id,
        });

        await request(app).post("/items/employees").set("Authorization", `Bearer ${adminToken}`).send({
            firstName: "Bob",
            lastName: "Developer",
            salary: 75000,
            status: "on_leave",
            hireDate: "2023-01-15",
            department_id: dept1.body.data.id,
            manager_id: manager1.body.data.id,
        });

        // Create projects
        await request(app).post("/items/projects").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Project Alpha",
            budget: 200000,
            status: "in_progress",
            department_id: dept1.body.data.id,
            lead_id: manager1.body.data.id,
            startDate: "2023-01-01",
            endDate: "2023-12-31",
        });

        await request(app).post("/items/projects").set("Authorization", `Bearer ${adminToken}`).send({
            name: "Project Beta",
            budget: 150000,
            status: "planning",
            department_id: dept2.body.data.id,
            lead_id: manager2.body.data.id,
            startDate: "2023-06-01",
        });
    }

    test("Verify test data", async () => {
        const response = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                fields: JSON.stringify(["*", "employees.*"]),
                include: JSON.stringify([{ relation: "employees" }])
            });

        console.log("Test Data:", JSON.stringify(response.body.data, null, 2));

        // Check if we have proper test data
        const hasValidData = response.body.data.some((dept) => {
            const hasHighSalary = dept.employees.some((emp) => emp.salary > 90000);
            const hasActiveRecent = dept.employees.some(
                (emp) => emp.status === "active" && new Date(emp.hireDate) > new Date("2023-01-01")
            );
            return (dept.status === "active" || dept.budget > 800000) && (hasHighSalary || hasActiveRecent);
        });

        expect(hasValidData).toBeTruthy();
    });

    test("Complex filter with nested AND/OR conditions", async () => {
        const complexFilter = {
            AND: [
                { OR: [{ status: { eq: "active" } }, { budget: { gt: 800000 } }] },
                {
                    OR: [
                        {
                            "employees.salary": { gt: 90000 },
                        },
                        {
                            AND: [
                                { "employees.status": { eq: "active" } },
                                { "employees.hireDate": { gt: "2023-02-16" } },
                            ],
                        },
                    ],
                },
            ],
        };

        const response = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify(complexFilter),
                fields: ["*", "employees.*", "projects.*", "projects.lead.*"],
                //fields: ["*.*"],
            });

        if (response.status !== 200) {
            console.error("Error Response:", JSON.stringify(response.body, null, 2));
        } else {
            console.log("Response:", JSON.stringify(response.body.data, null, 2));
        }

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1); // Should only return Engineering department

        const department = response.body.data[0];
        expect(department.name).toBe("Engineering");
        expect(department.status).toBe("active");
        expect(department.budget).toBeGreaterThan(800000);

        // Verify employees condition
        const hasHighSalaryEmployee = department.employees.some((emp) => emp.salary > 90000);
        const hasActiveRecentEmployee = department.employees.some(
            (emp) => emp.status === "active" && new Date(emp.hireDate) > new Date("2023-01-01")
        );

        expect(hasHighSalaryEmployee || hasActiveRecentEmployee).toBe(true);

        // Additional specific checks
        if (hasHighSalaryEmployee) {
            const highSalaryEmployees = department.employees.filter((emp) => emp.salary > 90000);
            expect(highSalaryEmployees.length).toBeGreaterThan(0);
            highSalaryEmployees.forEach((emp) => {
                expect(emp.salary).toBeGreaterThan(90000);
            });
        }

        if (hasActiveRecentEmployee) {
            const recentActiveEmployees = department.employees.filter(
                (emp) => emp.status === "active" && new Date(emp.hireDate) > new Date("2023-01-01")
            );

            console.log("Recent Active Employees:", JSON.stringify(recentActiveEmployees, null, 2));

            expect(recentActiveEmployees.length).toBeGreaterThan(0);
            recentActiveEmployees.forEach((emp) => {
                expect(emp.status).toBe("active");
                // Convert dates to timestamps for comparison
                expect(new Date(emp.hireDate).getTime()).toBeGreaterThan(new Date("2023-01-01").getTime());
            });
        }
    });

    test("Complex filter with two-level nested HasMany relConditions", async () => {
        // First, add a Tasks schema for employees
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "tasks",
                schema: {
                    name: "Task",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        status: { type: "String", allowNull: false },
                        priority: { type: "Integer", allowNull: false },
                        dueDate: { type: "DateTime", allowNull: true },
                    },
                },
            });

        // Add relation between employees and tasks
        await request(app).post("/schemas/tasks/relationships").set("Authorization", `Bearer ${adminToken}`).send({
            type: "M2O",
            target: "employees",
            name: "employee",
            alias: "tasks",
        });

        // Add relation between tasks and departments through employees
        await request(app)
            .patch("/schemas/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                schema: {
                    name: "Department",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        budget: { type: "Double", allowNull: false },
                        status: { type: "String", allowNull: false },
                        createdAt: { type: "DateTime", defaultValue: { type: "NOW" } },
                        employees: {
                            relType: "HasMany",
                            target: "employees",
                            foreignKey: "department_id",
                            as: "employees",
                        },
                        employeeTasks: {
                            relType: "HasMany",
                            target: "tasks",
                            through: "employees",
                            foreignKey: "department_id",
                            otherKey: "employee_id",
                            as: "employeeTasks",
                        },
                    },
                },
            });

        // Create test data: Add tasks for employees
        const employees = await request(app).get("/items/employees").set("Authorization", `Bearer ${adminToken}`);

        // Add tasks for each employee
        for (const employee of employees.body.data) {
            const numTasks = 3; //Math.floor(Math.random() * 3) + 1; // 1-3 tasks per employee
            for (let i = 0; i < numTasks; i++) {
                await request(app)
                    .post("/items/tasks")
                    .set("Authorization", `Bearer ${adminToken}`)
                    .send({
                        name: `Task ${i + 1} for ${employee.firstName}`,
                        status: ["pending", "in_progress", "completed"][i],
                        priority: i + 1 + 1,
                        dueDate: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000), // Random date within next week
                        employee_id: employee.id,
                    });
            }
        }

        // Test the complex filter with nested relConditions
        const response = await request(app)
            .get("/items/departments")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                fields: ["*", "employees.*", "employees.tasks.*"],
                filter: JSON.stringify({
                    AND: [{ status: { eq: "active" } }, { budget: { gt: 800000 } }],
                }),
                relConditions: JSON.stringify({
                    employees: {
                        AND: [{ salary: { gt: 70000 } }, { status: { eq: "active" } }],
                        tasks: {
                            AND: [{ priority: { gt: 1 } }, { status: { ne: "completed" } }],
                        },
                    },
                }),
            });

        console.log("Response with nested relConditions:", JSON.stringify(response.body.data, null, 2));

        expect(response.status).toBe(200);

        // Verify the response
        const department = response.body.data[0];
        expect(department.name).toBe("Engineering");
        expect(department.status).toBe("active");
        expect(department.budget).toBeGreaterThan(800000);

        // Verify employees meet conditions
        department.employees.forEach((employee) => {
            expect(employee.salary).toBeGreaterThan(70000);
            expect(employee.status).toBe("active");

            // Verify tasks meet conditions
            employee.tasks.forEach((task) => {
                expect(task.priority).toBeGreaterThan(1);
                expect(task.status).not.toBe("completed");
            });
        });

        // Clean up: Delete the tasks schema
        await request(app).delete("/schemas/tasks").set("Authorization", `Bearer ${adminToken}`);
    });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
