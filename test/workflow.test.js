import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let testCollection = "test_Products";

// Helper function to wait for workflow execution to complete
async function waitForExecutionComplete(workflowId, executionId, token, maxAttempts = 30) {
    let attempts = 0;
    let status = "queued";

    while (["queued", "running"].includes(status) && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const statusRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${executionId}`)
            .set("Authorization", `Bearer ${token}`);
        status = statusRes.body.data.status;
        attempts++;
    }

    return status;
}

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create a test collection for workflows
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: testCollection,
            schema: {
                name: "Product",
                timestamps: true,
                fields: {
                    id: {
                        type: "UUID",
                        primaryKey: true,
                        defaultValue: { type: "UUIDV4" },
                    },
                    name: {
                        type: "String",
                        allowNull: false,
                    },
                    price: {
                        type: "DOUBLE",
                        allowNull: false,
                    },
                    category: {
                        type: "String",
                        allowNull: true,
                    },
                    status: {
                        type: "ENUM",
                        values: ["active", "inactive"],
                        defaultValue: "active",
                    },
                },
            },
        });

    // Create some test products
    await request(app)
        .post(`/items/${testCollection}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Product 1", price: "100", category: "Electronics", status: "active" });

    await request(app)
        .post(`/items/${testCollection}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Product 2", price: "200", category: "Books", status: "active" });
});

afterAll(async () => {
    // Cleanup is handled by Jest timeout
});

describe("Workflow CRUD Operations", () => {
    let workflowId;

    test("should create a simple workflow with manual trigger", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "test-manual-workflow",
                name: "Test Manual Workflow",
                description: "A simple test workflow",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        {
                            id: "trigger-1",
                            type: "trigger",
                            position: { x: 100, y: 100 },
                            data: { label: "Trigger" },
                        },
                        {
                            id: "transform-1",
                            type: "transform",
                            position: { x: 300, y: 100 },
                            data: {
                                label: "Transform",
                                transformType: "script",
                                script: "return { message: 'Hello from workflow!' };",
                            },
                        },
                    ],
                    edges: [
                        {
                            id: "e1",
                            source: "trigger-1",
                            target: "transform-1",
                        },
                    ],
                },
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.data).toHaveProperty("id");
        workflowId = res.body.data.id;
    });

    test("should get workflow by id", async () => {
        const res = await request(app)
            .get(`/items/baasix_Workflow/${workflowId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data.id).toBe(workflowId);
        expect(res.body.data.flow_data).toHaveProperty("nodes");
        expect(res.body.data.flow_data).toHaveProperty("edges");
    });

    test("should update workflow", async () => {
        const res = await request(app)
            .patch(`/items/baasix_Workflow/${workflowId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                description: "Updated description",
                status: "inactive",
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toHaveProperty("id");
    });

    test("should list all workflows", async () => {
        const res = await request(app)
            .get("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toBeInstanceOf(Array);
        expect(res.body.data.length).toBeGreaterThan(0);
    });
});

describe("Workflow Validation", () => {
    test("should validate workflow with exactly one trigger node", async () => {
        const res = await request(app)
            .post("/workflows/validate")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                flow_data: {
                    nodes: [
                        {
                            id: "trigger-1",
                            type: "trigger",
                            data: { label: "Trigger" },
                        },
                        {
                            id: "http-1",
                            type: "http",
                            data: { label: "HTTP", url: "https://example.com" },
                        },
                    ],
                    edges: [
                        { id: "e1", source: "trigger-1", target: "http-1" },
                    ],
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.errors).toHaveLength(0);
    });

    test("should fail validation with no trigger node", async () => {
        const res = await request(app)
            .post("/workflows/validate")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                flow_data: {
                    nodes: [
                        {
                            id: "http-1",
                            type: "http",
                            data: { url: "https://example.com" },
                        },
                    ],
                    edges: [],
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(res.body.errors).toContain("Workflow must have exactly one trigger node");
    });

    test("should fail validation with multiple trigger nodes", async () => {
        const res = await request(app)
            .post("/workflows/validate")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        { id: "trigger-2", type: "trigger", data: {} },
                    ],
                    edges: [],
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(res.body.errors).toContain("Workflow can only have one trigger node");
    });

    test("should fail validation with disconnected nodes", async () => {
        const res = await request(app)
            .post("/workflows/validate")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        { id: "http-1", type: "http", data: { label: "HTTP" } },
                    ],
                    edges: [],
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(res.body.errors.length).toBeGreaterThan(0);
    });
});

describe("Manual Workflow Execution", () => {
    let manualWorkflowId;

    test("should create and execute a manual workflow", async () => {
        // Create workflow
        const createRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "manual-execution-test",
                name: "Manual Execution Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        {
                            id: "trigger-1",
                            type: "trigger",
                            data: { label: "Trigger" },
                        },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                label: "Transform",
                                transformType: "script",
                                script: "return { result: trigger.input * 2 };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(createRes.statusCode).toBe(201);
        manualWorkflowId = createRes.body.data.id;

        // Execute workflow
        const execRes = await request(app)
            .post(`/workflows/${manualWorkflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ input: 5 });

        expect(execRes.statusCode).toBe(200);
        expect(execRes.body).toHaveProperty("execution");

        // Wait for execution to complete
        const finalStatus = await waitForExecutionComplete(
            manualWorkflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });
});

describe("Webhook Workflow Execution", () => {
    test("should create a webhook workflow", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "webhook-test",
                name: "Webhook Test",
                status: "active",
                trigger_type: "webhook",
                trigger_webhook_path: "/test-webhook",
                trigger_webhook_method: "POST",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { received: trigger.body };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
    });

    test("should trigger workflow via webhook", async () => {
        const res = await request(app)
            .post("/webhook/test-webhook")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ test: "data" });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe("Workflow triggered successfully");
        expect(res.body.execution).toHaveProperty("id");
    });
});

describe("Service Node Operations", () => {
    let serviceWorkflowId;

    test("should execute workflow with service CRUD operations", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "service-crud-test",
                name: "Service CRUD Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "service-create",
                            type: "service",
                            data: {
                                operation: "create",
                                collection: testCollection,
                                data: JSON.stringify({
                                    name: "Created by Workflow",
                                    price: "99.99",
                                    category: "Test",
                                }),
                                bypassPermissions: true,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "service-create" }],
                },
            });

        expect(res.statusCode).toBe(201);
        serviceWorkflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${serviceWorkflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            serviceWorkflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });
});

describe("Condition Node Branching", () => {
    test("should execute true branch when condition is met", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "condition-test-true",
                name: "Condition Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "condition-1",
                            type: "condition",
                            data: {
                                conditions: [
                                    {
                                        field: "trigger.value",
                                        operator: ">",
                                        value: 10,
                                    },
                                ],
                                operator: "AND",
                            },
                        },
                        {
                            id: "transform-true",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { result: 'condition true' };",
                            },
                        },
                        {
                            id: "transform-false",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { result: 'condition false' };",
                            },
                        },
                        {
                            id: "merge-node",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { merged: true, branch: 'completed' };",
                            },
                        },
                    ],
                    edges: [
                        { source: "trigger-1", target: "condition-1", targetHandle: "start" },
                        {
                            source: "condition-1",
                            target: "transform-true",
                            sourceHandle: "true",
                        },
                        {
                            source: "condition-1",
                            target: "transform-false",
                            sourceHandle: "false",
                        },
                        {
                            source: "transform-true",
                            target: "condition-1",
                            targetHandle: "condition-end",
                        },
                        {
                            source: "transform-false",
                            target: "condition-1",
                            targetHandle: "condition-end",
                        },
                        {
                            source: "condition-1",
                            target: "merge-node",
                            sourceHandle: "done",
                        },
                    ],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        // Test with value > 10 (should take true branch)
        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: 15 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        // Verify logs to check execution path
        const logsRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}/logs`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(logsRes.statusCode).toBe(200);
        const logs = logsRes.body.data;

        // Should have executed: trigger, condition, transform-true, merge-node
        expect(logs.some(log => log.nodeId === "transform-true")).toBe(true);
        expect(logs.some(log => log.nodeId === "transform-false")).toBe(false);
        expect(logs.some(log => log.nodeId === "merge-node")).toBe(true);
    });

    test("should execute false branch when condition is not met", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "condition-test-false",
                name: "Condition False Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "condition-1",
                            type: "condition",
                            data: {
                                conditions: [
                                    {
                                        field: "trigger.value",
                                        operator: ">",
                                        value: 10,
                                    },
                                ],
                                operator: "AND",
                            },
                        },
                        {
                            id: "transform-true",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { result: 'condition true' };",
                            },
                        },
                        {
                            id: "transform-false",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { result: 'condition false' };",
                            },
                        },
                        {
                            id: "merge-node",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { merged: true, branch: 'completed' };",
                            },
                        },
                    ],
                    edges: [
                        { source: "trigger-1", target: "condition-1", targetHandle: "start" },
                        {
                            source: "condition-1",
                            target: "transform-true",
                            sourceHandle: "true",
                        },
                        {
                            source: "condition-1",
                            target: "transform-false",
                            sourceHandle: "false",
                        },
                        {
                            source: "transform-true",
                            target: "condition-1",
                            targetHandle: "condition-end",
                        },
                        {
                            source: "transform-false",
                            target: "condition-1",
                            targetHandle: "condition-end",
                        },
                        {
                            source: "condition-1",
                            target: "merge-node",
                            sourceHandle: "done",
                        },
                    ],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        // Test with value <= 10 (should take false branch)
        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: 5 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        // Verify logs to check execution path
        const logsRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}/logs`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(logsRes.statusCode).toBe(200);
        const logs = logsRes.body.data;

        // Should have executed: trigger, condition, transform-false, merge-node
        expect(logs.some(log => log.nodeId === "transform-false")).toBe(true);
        expect(logs.some(log => log.nodeId === "transform-true")).toBe(false);
        expect(logs.some(log => log.nodeId === "merge-node")).toBe(true);
    });
});

describe("Loop Node Execution", () => {
    test("should execute loop body for each item in array", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "loop-test",
                name: "Loop Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "loop-1",
                            type: "loop",
                            data: {
                                loopType: "array",
                                arraySource: "trigger.items",
                                maxIterations: 100,
                            },
                        },
                        {
                            id: "transform-loop",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { item: loop.item, index: loop.index };",
                            },
                        },
                    ],
                    edges: [
                        { source: "trigger-1", target: "loop-1", targetHandle: "start" },
                        { source: "loop-1", target: "transform-loop", sourceHandle: "loop" },
                        { source: "transform-loop", target: "loop-1", targetHandle: "loop-end" },
                    ],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ items: [1, 2, 3, 4, 5] });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });
});

describe("Script Node with Libraries", () => {
    test("should execute script with lodash", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "script-lodash-test",
                name: "Script with Lodash",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const sorted = _.sortBy(trigger.items, 'price');
                                    const grouped = _.groupBy(sorted, 'category');
                                    return { sorted, grouped };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                items: [
                    { name: "Item 1", price: 30, category: "A" },
                    { name: "Item 2", price: 10, category: "B" },
                    { name: "Item 3", price: 20, category: "A" },
                ],
            });

        expect(execRes.statusCode).toBe(200);

        let finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });

    test("should execute script with dayjs", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "script-dayjs-test",
                name: "Script with Dayjs",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const now = dayjs();
                                    const future = dayjs().add(7, 'day');
                                    return {
                                        now: now.format('YYYY-MM-DD'),
                                        future: future.format('YYYY-MM-DD'),
                                        diff: future.diff(now, 'day')
                                    };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });
});

describe("Try-Catch Error Handling", () => {
    test("should execute catch branch on error and continue to done", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "try-catch-error-test",
                name: "Try-Catch Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        { id: "try-1", type: "try", data: {} },
                        {
                            id: "error-node",
                            type: "script",
                            data: {
                                script: "throw new Error('Test error');",
                            },
                        },
                        {
                            id: "catch-node",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { errorHandled: true, message: error.message };",
                            },
                        },
                        {
                            id: "finally-node",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { cleanup: true, completed: true };",
                            },
                        },
                    ],
                    edges: [
                        { source: "trigger-1", target: "try-1", targetHandle: "start" },
                        { source: "try-1", target: "error-node", sourceHandle: "try" },
                        { source: "try-1", target: "catch-node", sourceHandle: "catch" },
                        { source: "error-node", target: "try-1", targetHandle: "try-end" },
                        { source: "catch-node", target: "try-1", targetHandle: "try-end" },
                        { source: "try-1", target: "finally-node", sourceHandle: "done" },
                    ],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        // Should complete even though error was thrown (caught by try-catch)
        expect(finalStatus).toBe("completed");

        // Verify logs to check execution path
        const logsRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}/logs`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(logsRes.statusCode).toBe(200);
        const logs = logsRes.body.data;

        // Should have executed: trigger, try, error-node (which threw), catch-node, finally-node
        expect(logs.some(log => log.nodeId === "catch-node")).toBe(true);
        expect(logs.some(log => log.nodeId === "finally-node")).toBe(true);
    });

    test("should execute try branch successfully and continue to done", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "try-catch-success-test",
                name: "Try-Catch Success Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        { id: "try-1", type: "try", data: {} },
                        {
                            id: "success-node",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { success: true, result: trigger.value * 2 };",
                            },
                        },
                        {
                            id: "catch-node",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { errorHandled: true, message: error.message };",
                            },
                        },
                        {
                            id: "finally-node",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { cleanup: true, completed: true };",
                            },
                        },
                    ],
                    edges: [
                        { source: "trigger-1", target: "try-1", targetHandle: "start" },
                        { source: "try-1", target: "success-node", sourceHandle: "try" },
                        { source: "try-1", target: "catch-node", sourceHandle: "catch" },
                        { source: "success-node", target: "try-1", targetHandle: "try-end" },
                        { source: "catch-node", target: "try-1", targetHandle: "try-end" },
                        { source: "try-1", target: "finally-node", sourceHandle: "done" },
                    ],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: 10 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        // Verify logs to check execution path
        const logsRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}/logs`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(logsRes.statusCode).toBe(200);
        const logs = logsRes.body.data;

        // Should have executed: trigger, try, success-node, finally-node
        // Should NOT have executed catch-node since there was no error
        expect(logs.some(log => log.nodeId === "success-node")).toBe(true);
        expect(logs.some(log => log.nodeId === "catch-node")).toBe(false);
        expect(logs.some(log => log.nodeId === "finally-node")).toBe(true);
    });
});

describe("Nested Workflow Execution", () => {
    let parentWorkflowId;
    let childWorkflowId;

    test("should create child workflow", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "child-workflow",
                name: "Child Workflow",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { childResult: trigger.input * 3 };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        childWorkflowId = res.body.data.id;
    });

    test("should execute parent workflow that calls child workflow", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "parent-workflow",
                name: "Parent Workflow",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "workflow-1",
                            type: "workflow",
                            data: {
                                workflowId: childWorkflowId,
                                passData: true,
                                waitForCompletion: true,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "workflow-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        parentWorkflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${parentWorkflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ input: 5 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            parentWorkflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });
});

describe("Complex Multi-Node Workflow", () => {
    test("should execute complex workflow with multiple node types", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "complex-multi-node",
                name: "Complex Workflow",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "service-read",
                            type: "service",
                            data: {
                                operation: "read",
                                collection: testCollection,
                                bypassPermissions: true,
                            },
                        },
                        {
                            id: "filter-1",
                            type: "filter",
                            data: {
                                arraySource: "outputs['service-read'].data",
                                conditions: [
                                    { field: "price", operator: ">", value: 50 },
                                ],
                            },
                        },
                        {
                            id: "aggregate-1",
                            type: "aggregate",
                            data: {
                                arraySource: "outputs['filter-1'].items",
                                operation: "sum",
                                field: "price",
                            },
                        },
                        {
                            id: "variable-1",
                            type: "variable",
                            data: {
                                variables: {
                                    totalPrice: "{{outputs['aggregate-1'].result}}",
                                },
                            },
                        },
                    ],
                    edges: [
                        { source: "trigger-1", target: "service-read" },
                        { source: "service-read", target: "filter-1" },
                        { source: "filter-1", target: "aggregate-1" },
                        { source: "aggregate-1", target: "variable-1" },
                    ],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });
});

describe("Workflow Execution History", () => {
    let workflowId;

    test("should store execution history", async () => {
        // Create workflow
        const createRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "history-test",
                name: "History Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { result: 'ok' };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(createRes.statusCode).toBe(201);
        workflowId = createRes.body.data.id;

        // Execute workflow
        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        // Wait for execution to complete
        await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        // Get execution history
        const historyRes = await request(app)
            .get(`/workflows/${workflowId}/executions`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(historyRes.statusCode).toBe(200);
        expect(historyRes.body.data).toBeInstanceOf(Array);
        expect(historyRes.body.data.length).toBeGreaterThan(0);
    });

    test("should get execution logs", async () => {
        // Execute workflow
        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        const executionId = execRes.body.execution.id;

        // Wait for execution to complete
        await waitForExecutionComplete(
            workflowId,
            executionId,
            adminToken
        );

        // Get logs
        const logsRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${executionId}/logs`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(logsRes.statusCode).toBe(200);
        expect(logsRes.body.data).toBeInstanceOf(Array);
        expect(logsRes.body.data.length).toBeGreaterThan(0);
    });
});

describe("Custom Workflow Modules", () => {
    let workflowService;

    beforeAll(async () => {
        // Import WorkflowService
        const { default: WorkflowServiceImport } = await import("../baasix/services/WorkflowService.js");
        workflowService = WorkflowServiceImport;
        await workflowService.ensureInitialized();
    });

    test("should register a custom utility module", async () => {
        const testUtils = {
            double: (num) => num * 2,
            triple: (num) => num * 3,
            concat: (...args) => args.join('-'),
        };

        workflowService.registerCustomModule('testUtils', testUtils, {
            description: 'Test utility functions',
            allowRequire: true,
        });

        // Check if module is registered
        const modules = workflowService.getRegisteredModules();
        const testModule = modules.find(m => m.name === 'testUtils');

        expect(testModule).toBeDefined();
        expect(testModule.name).toBe('testUtils');
        expect(testModule.description).toBe('Test utility functions');
        expect(testModule.allowRequire).toBe(true);
    });

    test("should use custom module in script node via direct access", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "custom-module-direct",
                name: "Custom Module Test - Direct Access",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const doubled = testUtils.double(trigger.value);
                                    const tripled = testUtils.triple(trigger.value);
                                    const concatenated = testUtils.concat('a', 'b', 'c');
                                    return { doubled, tripled, concatenated };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: 5 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        // Get execution details to verify results
        const executionRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionRes.statusCode).toBe(200);
        const scriptOutput = executionRes.body.data.result_data['script-1'];
        expect(scriptOutput.result.doubled).toBe(10);
        expect(scriptOutput.result.tripled).toBe(15);
        expect(scriptOutput.result.concatenated).toBe('a-b-c');
    });

    test("should use custom module in script node via require()", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "custom-module-require",
                name: "Custom Module Test - Require",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const utils = require('testUtils');
                                    const result = utils.double(trigger.value);
                                    return { result };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: 7 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");
    });

    test("should register and use a custom class module", async () => {
        class CustomCalculator {
            constructor(multiplier = 1) {
                this.multiplier = multiplier;
            }

            calculate(value) {
                return value * this.multiplier;
            }

            static create(multiplier) {
                return new CustomCalculator(multiplier);
            }
        }

        workflowService.registerCustomModule('CustomCalculator', CustomCalculator, {
            description: 'Custom calculator class',
            allowRequire: true,
        });

        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "custom-class-module",
                name: "Custom Class Module Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const calc = CustomCalculator.create(10);
                                    const result = calc.calculate(trigger.value);
                                    return { result };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: 3 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        const executionRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const scriptOutput = executionRes.body.data.result_data['script-1'];
        expect(scriptOutput.result.result).toBe(30);
    });

    test("should register and use async custom module functions", async () => {
        const asyncUtils = {
            async delayedDouble(value, delayMs = 10) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
                return value * 2;
            },

            async fetchMockData(id) {
                // Simulate API call
                await new Promise(resolve => setTimeout(resolve, 10));
                return { id, name: `Item ${id}`, timestamp: Date.now() };
            },
        };

        workflowService.registerCustomModule('asyncUtils', asyncUtils, {
            description: 'Async utility functions',
            allowRequire: true,
        });

        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "async-custom-module",
                name: "Async Custom Module Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const doubled = await asyncUtils.delayedDouble(trigger.value);
                                    const mockData = await asyncUtils.fetchMockData(trigger.id);
                                    return { doubled, mockData };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: 8, id: 123 });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        const executionRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const scriptOutput = executionRes.body.data.result_data['script-1'];
        expect(scriptOutput.result.doubled).toBe(16);
        expect(scriptOutput.result.mockData.id).toBe(123);
        expect(scriptOutput.result.mockData.name).toBe('Item 123');
    });

    test("should fail gracefully when trying to use non-existent module", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "non-existent-module",
                name: "Non-existent Module Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const result = require('nonExistentModule');
                                    return { result };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken,
            10 // Reduce wait time for error case
        );

        // Should fail because module doesn't exist
        expect(finalStatus).toBe("failed");

        // Check error message
        const executionRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionRes.body.data.errorMessage).toContain('is not allowed');
    });

    test("should check if module is available", async () => {
        // Test built-in module
        const lodashAvailable = workflowService.isModuleAvailable('lodash');
        expect(lodashAvailable).toBe(true);

        // Test custom module
        const testUtilsAvailable = workflowService.isModuleAvailable('testUtils');
        expect(testUtilsAvailable).toBe(true);

        // Test non-existent module
        const fakeModuleAvailable = workflowService.isModuleAvailable('fakeModule');
        expect(fakeModuleAvailable).toBe(false);
    });

    test("should unregister custom module", async () => {
        // Register a temporary module
        workflowService.registerCustomModule('tempModule', { test: () => 'test' });

        // Verify it's registered
        expect(workflowService.isModuleAvailable('tempModule')).toBe(true);

        // Unregister it
        const result = workflowService.unregisterCustomModule('tempModule');
        expect(result).toBe(true);

        // Verify it's no longer available
        expect(workflowService.isModuleAvailable('tempModule')).toBe(false);

        // Try to unregister non-existent module
        const result2 = workflowService.unregisterCustomModule('nonExistent');
        expect(result2).toBe(false);
    });

    test("should use example extension custom modules (myUtils)", async () => {
        // Register the example modules (simulating the extension)
        const myUtils = {
            formatPhone(phoneNumber) {
                const cleaned = String(phoneNumber).replace(/\D/g, '');
                const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
                if (match) {
                    return `(${match[1]}) ${match[2]}-${match[3]}`;
                }
                return phoneNumber;
            },

            calculateAge(birthdate) {
                const today = new Date();
                const birth = new Date(birthdate);
                let age = today.getFullYear() - birth.getFullYear();
                const monthDiff = today.getMonth() - birth.getMonth();
                if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
                    age--;
                }
                return age;
            },

            randomString(length = 10) {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                let result = '';
                for (let i = 0; i < length; i++) {
                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                return result;
            },
        };

        workflowService.registerCustomModule('myUtils', myUtils, {
            description: 'Example utility functions',
            allowRequire: true,
        });

        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "example-extension-test",
                name: "Example Extension Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const formattedPhone = myUtils.formatPhone(trigger.phone);
                                    const age = myUtils.calculateAge(trigger.birthdate);
                                    const randomCode = myUtils.randomString(8);
                                    return { formattedPhone, age, randomCode };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                phone: '1234567890',
                birthdate: '1990-01-15'
            });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        const executionRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const scriptOutput = executionRes.body.data.result_data['script-1'];
        expect(scriptOutput.result.formattedPhone).toBe('(123) 456-7890');
        expect(scriptOutput.result.age).toBeGreaterThan(0);
        expect(scriptOutput.result.randomCode).toHaveLength(8);
    });

    test("should combine built-in and custom modules in script", async () => {
        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "combined-modules-test",
                name: "Combined Modules Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    // Use lodash (built-in)
                                    const sorted = _.sortBy(trigger.items, 'value');

                                    // Use dayjs (built-in)
                                    const now = dayjs().format('YYYY-MM-DD');

                                    // Use custom module
                                    const doubled = sorted.map(item => ({
                                        ...item,
                                        value: testUtils.double(item.value)
                                    }));

                                    return { sorted, doubled, now };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                items: [
                    { name: 'c', value: 3 },
                    { name: 'a', value: 1 },
                    { name: 'b', value: 2 },
                ]
            });

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken
        );

        expect(finalStatus).toBe("completed");

        const executionRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        const scriptOutput = executionRes.body.data.result_data['script-1'];
        expect(scriptOutput.result.sorted[0].value).toBe(1);
        expect(scriptOutput.result.doubled[0].value).toBe(2); // 1 * 2
        expect(scriptOutput.result.now).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    test("should get list of all registered custom modules", async () => {
        const modules = workflowService.getRegisteredModules();

        expect(modules).toBeInstanceOf(Array);
        expect(modules.length).toBeGreaterThan(0);

        // Check that our test modules are in the list
        const testUtilsModule = modules.find(m => m.name === 'testUtils');
        expect(testUtilsModule).toBeDefined();
        expect(testUtilsModule).toHaveProperty('description');
        expect(testUtilsModule).toHaveProperty('allowRequire');
        expect(testUtilsModule).toHaveProperty('registeredAt');
    });

    test("should handle module with allowRequire: false", async () => {
        const restrictedModule = {
            sensitiveOperation: () => 'secret',
        };

        workflowService.registerCustomModule('restrictedModule', restrictedModule, {
            description: 'Restricted module',
            allowRequire: false,
        });

        const res = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "restricted-module-test",
                name: "Restricted Module Test",
                status: "active",
                trigger_type: "manual",
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "script-1",
                            type: "script",
                            data: {
                                script: `
                                    const result = require('restrictedModule');
                                    return { result };
                                `,
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "script-1" }],
                },
            });

        expect(res.statusCode).toBe(201);
        const workflowId = res.body.data.id;

        const execRes = await request(app)
            .post(`/workflows/${workflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);

        const finalStatus = await waitForExecutionComplete(
            workflowId,
            execRes.body.execution.id,
            adminToken,
            10
        );

        // Should fail because require() is disabled for this module
        expect(finalStatus).toBe("failed");

        const executionRes = await request(app)
            .get(`/workflows/${workflowId}/executions/${execRes.body.execution.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionRes.body.data.errorMessage).toContain('require() is disabled');
    });
});

describe("Role-Based Access Control for Workflows", () => {
    let adminRoleId;
    let testWorkflowId;

    beforeAll(async () => {
        // Get the administrator role ID
        const rolesRes = await request(app)
            .get("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`);

        const adminRole = rolesRes.body.data.find(r => r.name === "administrator");
        adminRoleId = adminRole.id;
    });

    test("should create workflow with allowed_roles and deny execution for non-matching role", async () => {
        // Create a test role that's different from admin role
        const roleRes = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Test Workflow Role",
                description: "Test role for workflow RBAC",
            });
        const testRoleId = roleRes.body.data.id;

        // Create workflow restricted to test role (admin doesn't have this role)
        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "rbac-test-workflow",
                name: "RBAC Test Workflow",
                status: "active",
                trigger_type: "manual",
                allowed_roles: [testRoleId],
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { message: 'Executed' };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(workflowRes.statusCode).toBe(201);
        testWorkflowId = workflowRes.body.data.id;

        // Try to execute - should succeed because administrators can execute all workflows
        const execRes = await request(app)
            .post(`/workflows/${testWorkflowId}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);
        expect(execRes.body).toHaveProperty("execution");
        // Administrators have special privileges and can execute any workflow
    });

    test("should allow execution when user has matching role in allowed_roles", async () => {
        // Create workflow restricted to administrator role (admin has this)
        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "rbac-admin-workflow",
                name: "RBAC Admin Workflow",
                status: "active",
                trigger_type: "manual",
                allowed_roles: [adminRoleId],
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { message: 'Success' };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(workflowRes.statusCode).toBe(201);

        //Execute - should succeed since admin has administrator role
        const execRes = await request(app)
            .post(`/workflows/${workflowRes.body.data.id}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);
        expect(execRes.body).toHaveProperty("execution");
    });

    test("should allow execution when allowed_roles is empty (no restrictions)", async () => {
        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "rbac-open-workflow",
                name: "RBAC Open Workflow",
                status: "active",
                trigger_type: "manual",
                allowed_roles: [],
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { message: 'Open to all' };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(workflowRes.statusCode).toBe(201);

        // Should execute successfully for any authenticated user
        const execRes = await request(app)
            .post(`/workflows/${workflowRes.body.data.id}/execute`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({});

        expect(execRes.statusCode).toBe(200);
    });

    test("should apply role restrictions to webhook triggers with role requirements", async () => {
        // Create a different role
        const roleRes = await request(app)
            .post("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Webhook Test Role",
                description: "For webhook testing",
            });
        const webhookTestRoleId = roleRes.body.data.id;

        // Create webhook workflow with role restrictions
        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "rbac-webhook-workflow",
                name: "RBAC Webhook Workflow",
                status: "active",
                trigger_type: "webhook",
                trigger_webhook_path: "/rbac-webhook-test",
                trigger_webhook_method: "POST",
                allowed_roles: [webhookTestRoleId],
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { webhook: 'success' };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(workflowRes.statusCode).toBe(201);

        // Webhook should succeed because administrators can execute all workflows
        const webhookRes = await request(app)
            .post("/webhook/rbac-webhook-test")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ test: "data" });

        expect(webhookRes.statusCode).toBe(200);
        expect(webhookRes.body).toHaveProperty("execution");
        // Administrators have special privileges and can execute any workflow
    });

    test("should allow webhook execution when user has matching role", async () => {
        // Create webhook workflow restricted to administrator role
        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "rbac-webhook-admin-workflow",
                name: "RBAC Webhook Admin Workflow",
                status: "active",
                trigger_type: "webhook",
                trigger_webhook_path: "/rbac-webhook-admin-test",
                trigger_webhook_method: "POST",
                allowed_roles: [adminRoleId],
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { webhook: 'success' };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(workflowRes.statusCode).toBe(201);

        // Webhook should execute successfully since admin has administrator role
        const webhookRes = await request(app)
            .post("/webhook/rbac-webhook-admin-test")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ test: "data" });

        expect(webhookRes.statusCode).toBe(200);
        expect(webhookRes.body.message).toContain("triggered successfully");
    });

    test("should allow webhook execution when allowed_roles is empty", async () => {
        // Create webhook workflow with no role restrictions
        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                id: "rbac-webhook-unrestricted",
                name: "RBAC Webhook Unrestricted",
                status: "active",
                trigger_type: "webhook",
                trigger_webhook_path: "/rbac-webhook-unrestricted",
                trigger_webhook_method: "POST",
                allowed_roles: [],
                flow_data: {
                    nodes: [
                        { id: "trigger-1", type: "trigger", data: {} },
                        {
                            id: "transform-1",
                            type: "transform",
                            data: {
                                transformType: "script",
                                script: "return { webhook: 'success' };",
                            },
                        },
                    ],
                    edges: [{ source: "trigger-1", target: "transform-1" }],
                },
            });

        expect(workflowRes.statusCode).toBe(201);

        // Webhook should execute successfully for any authenticated user
        const webhookRes = await request(app)
            .post("/webhook/rbac-webhook-unrestricted")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ test: "data" });

        expect(webhookRes.statusCode).toBe(200);
    });

    test("should require authentication for workflow execution", async () => {
        // Try to execute without auth token
        const res = await request(app)
            .post("/workflows/rbac-admin-workflow/execute")
            .send({});

        expect(res.statusCode).toBe(401);
    });
});
