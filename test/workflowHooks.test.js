import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
let testCollection = "test_HookProducts";

// Helper to create workflow with proper structure
function createWorkflowPayload(id, name, hookAction, nodes, edges) {
    // Add position to all nodes that don't have it
    const nodesWithPosition = nodes.map((node, index) => ({
        ...node,
        position: node.position || { x: 100 + index * 200, y: 100 },
    }));

    // Add id to all edges that don't have it
    const edgesWithId = edges.map((edge, index) => ({
        ...edge,
        id: edge.id || `e${index + 1}`,
    }));

    return {
        id,
        name,
        description: `Test workflow for ${hookAction}`,
        status: "active",
        trigger_type: "hook",
        trigger_hook_collection: testCollection,
        trigger_hook_action: hookAction,
        flow_data: {
            nodes: nodesWithPosition,
            edges: edgesWithId,
        },
    };
}

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;

    // Create a test collection for workflow hooks
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: testCollection,
            schema: {
                name: "HookProduct",
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
                        values: ["active", "inactive", "pending"],
                        defaultValue: "pending",
                    },
                    description: {
                        type: "TEXT",
                        allowNull: true,
                    },
                },
            },
        });
});

afterAll(async () => {
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});

describe("Workflow Hook - items.create (Before Hook)", () => {
    test("should modify data before create using workflow", async () => {
        // Create workflow
        const workflow = createWorkflowPayload(
            "hook-create-modify",
            "Modify Create Data",
            "items.create",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Modify Data",
                        script: `
                            console.info("Workflow script executing for items.create", trigger.data);
                            const modifiedData = {
                                ...trigger.data,
                                status: 'active',
                                description: 'Modified by workflow'
                            };
                            return { data: modifiedData };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        // Wait for workflow to register
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create an item
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Test Product",
                price: "100",
                category: "Electronics",
                status: "pending",
            });

        expect(createRes.status).toBe(201);
        const productId = createRes.body.data.id;

        // Read to verify modifications
        const readRes = await request(app)
            .get(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.body.data).toMatchObject({
            name: "Test Product",
            status: "active", // Modified by workflow
            description: "Modified by workflow",
        });
    });
});

describe("Workflow Hook - items.read (Before Hook)", () => {
    test("should modify query before read using workflow", async () => {
        // Create test products with different statuses
        const product1 = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Active Product",
                price: "100",
                status: "active",
            });

        const product2 = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Inactive Product",
                price: "200",
                status: "inactive",
            });

        expect(product1.status).toBe(201);
        expect(product2.status).toBe(201);

        // Create workflow that filters query
        const workflow = createWorkflowPayload(
            "hook-read-filter",
            "Filter Active Only",
            "items.read",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Add Status Filter",
                        script: `
                            const modifiedQuery = {
                                ...trigger.query,
                                filter: {
                                    ...(trigger.query.filter || {}),
                                    status: 'active'
                                }
                            };
                            return { query: modifiedQuery };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        // Wait for workflow to register
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Read items - should only return active
        const readRes = await request(app)
            .get(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.status).toBe(200);

        // Verify all are active
        const products = readRes.body.data;
        expect(products.length).toBeGreaterThan(0);
        products.forEach((product) => {
            expect(product.status).toBe("active");
        });
    });
});

describe("Workflow Hook - items.update (Before Hook)", () => {
    test("should modify update data using workflow", async () => {
        // Create a product
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Product to Update",
                price: "100",
                status: "pending",
            });

        const productId = createRes.body.data.id;

        // Create workflow
        const workflow = createWorkflowPayload(
            "hook-update-modify",
            "Modify Update Data",
            "items.update",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Add Description",
                        script: `
                            const modifiedData = {
                                ...trigger.data,
                                description: 'Updated by workflow'
                            };
                            return { data: modifiedData };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        // Wait for workflow
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Update product
        const updateRes = await request(app)
            .patch(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ price: "150" });

        expect(updateRes.status).toBe(200);

        // Verify workflow added description
        const readRes = await request(app)
            .get(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.body.data.price).toBe(150);
        expect(readRes.body.data.description).toBe("Updated by workflow");
    });
});

describe("Workflow Hook - items.read.one (Before Hook)", () => {
    test("should modify query before reading single item", async () => {
        // Create a product
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Read One Test",
                price: "100",
                status: "active",
            });

        expect(createRes.status).toBe(201);
        const productId = createRes.body.data.id;

        // Create workflow that adds a filter to the query
        const workflow = createWorkflowPayload(
            "hook-read-one-filter",
            "Read One Filter",
            "items.read.one",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Add Query Filter",
                        script: `
                            const modifiedQuery = {
                                ...trigger.query,
                                filter: {
                                    ...(trigger.query?.filter || {}),
                                    status: 'active'
                                }
                            };
                            return { query: modifiedQuery };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Read the item - workflow will add status filter
        const readRes = await request(app)
            .get(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.status).toBe(200);
        expect(readRes.body.data.status).toBe("active");
    });
});

describe("Workflow Hook - items.delete (Before Hook)", () => {
    test("should execute workflow before delete", async () => {
        // Create workflow for before delete hook
        const workflow = createWorkflowPayload(
            "hook-delete-before",
            "Before Delete Hook",
            "items.delete",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Log Delete Attempt",
                        script: `
                            console.info('Before delete hook triggered for item:', trigger.id);
                            return {};
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create a product
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Delete Test",
                price: "100",
                status: "active",
            });

        expect(createRes.status).toBe(201);
        const productId = createRes.body.data.id;

        // Delete the product - workflow should execute before delete
        const deleteRes = await request(app)
            .delete(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(deleteRes.status).toBe(200);
    });
});

describe("Workflow Hook - items.create.after (After Hook)", () => {
    test("should execute after create without blocking", async () => {
        // Create workflow for after hook
        const workflow = createWorkflowPayload(
            "hook-create-after",
            "After Create Hook",
            "items.create.after",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Log Create",
                        script: `
                            if (!trigger.data || !trigger.data.id) {
                                throw new Error('Document not available');
                            }
                            return { documentId: trigger.data.id };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create product
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "After Hook Test",
                price: "99",
                status: "active",
            });

        expect(createRes.status).toBe(201);

        // Wait for async workflow
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Check workflow executed
        const executionsRes = await request(app)
            .get(
                `/items/baasix_WorkflowExecution?filter[workflow_Id]=${workflowRes.body.data.id}&sort={"createdAt":"desc"}&limit=1`
            )
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionsRes.status).toBe(200);
        expect(executionsRes.body.data.length).toBeGreaterThan(0);
        const execution = executionsRes.body.data[0];
        expect(execution.status).toBe("completed");
    });
});

describe("Workflow Hook - items.read.after (After Hook)", () => {
    test("should execute after read without modifying results", async () => {
        // Create some products
        await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Read After Test 1",
                price: "100",
                status: "active",
            });

        // Create workflow for after read hook
        const workflow = createWorkflowPayload(
            "hook-read-after",
            "After Read Hook",
            "items.read.after",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Log Read",
                        script: `
                            console.info('Read after hook triggered', trigger.result);
                            return { logged: true };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Read items - should trigger after hook
        const readRes = await request(app)
            .get(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.status).toBe(200);

        // Wait for async workflow
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Check workflow executed
        const executionsRes = await request(app)
            .get(
                `/items/baasix_WorkflowExecution?filter[workflow_Id]=${workflowRes.body.data.id}&sort={"createdAt":"desc"}&limit=1`
            )
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionsRes.status).toBe(200);
        expect(executionsRes.body.data.length).toBeGreaterThan(0);
    });
});

describe("Workflow Hook - items.read.one.after (After Hook)", () => {
    test("should execute after reading single item", async () => {
        // Create a product
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Read One After Test",
                price: "100",
                status: "active",
            });

        const productId = createRes.body.data.id;

        // Create workflow for after read one hook
        const workflow = createWorkflowPayload(
            "hook-read-one-after",
            "After Read One Hook",
            "items.read.one.after",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Log Read One",
                        script: `
                            console.info('Read one after hook triggered');
                            return { logged: true };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Read single item
        const readRes = await request(app)
            .get(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(readRes.status).toBe(200);

        // Wait for async workflow
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Check workflow executed
        const executionsRes = await request(app)
            .get(
                `/items/baasix_WorkflowExecution?filter[workflow_Id]=${workflowRes.body.data.id}&sort={"createdAt":"desc"}&limit=1`
            )
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionsRes.status).toBe(200);
        expect(executionsRes.body.data.length).toBeGreaterThan(0);
    });
});

describe("Workflow Hook - items.update.after (After Hook)", () => {
    test("should execute after update without blocking", async () => {
        // Create a product
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Update After Test",
                price: "100",
                status: "pending",
            });

        const productId = createRes.body.data.id;

        // Create workflow for after update hook
        const workflow = createWorkflowPayload(
            "hook-update-after",
            "After Update Hook",
            "items.update.after",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Log Update",
                        script: `
                            console.info('Update after hook triggered', trigger.data);
                            return { logged: true };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Update product
        const updateRes = await request(app)
            .patch(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ status: "active" });

        expect(updateRes.status).toBe(200);

        // Wait for async workflow
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Check workflow executed
        const executionsRes = await request(app)
            .get(
                `/items/baasix_WorkflowExecution?filter[workflow_Id]=${workflowRes.body.data.id}&sort={"createdAt":"desc"}&limit=1`
            )
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionsRes.status).toBe(200);
        expect(executionsRes.body.data.length).toBeGreaterThan(0);
    });
});

describe("Workflow Hook - items.delete.after (After Hook)", () => {
    test("should execute after delete without blocking", async () => {
        // Create workflow for after delete hook first
        const workflow = createWorkflowPayload(
            "hook-delete-after",
            "After Delete Hook",
            "items.delete.after",
            [
                {
                    id: "trigger-1",
                    type: "trigger",
                    data: { label: "Trigger" },
                },
                {
                    id: "script-1",
                    type: "script",
                    data: {
                        label: "Log Delete",
                        script: `
                            console.info('Delete after hook triggered');
                            return { logged: true };
                        `,
                    },
                },
            ],
            [{ source: "trigger-1", target: "script-1" }]
        );

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create a product
        const createRes = await request(app)
            .post(`/items/${testCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Delete After Test",
                price: "100",
                status: "active",
            });

        const productId = createRes.body.data.id;

        // Delete product
        const deleteRes = await request(app)
            .delete(`/items/${testCollection}/${productId}`)
            .set("Authorization", `Bearer ${adminToken}`);

        expect(deleteRes.status).toBe(200);

        // Wait for async workflow
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Check workflow executed
        const executionsRes = await request(app)
            .get(
                `/items/baasix_WorkflowExecution?filter[workflow_Id]=${workflowRes.body.data.id}&sort={"createdAt":"desc"}&limit=1`
            )
            .set("Authorization", `Bearer ${adminToken}`);

        expect(executionsRes.status).toBe(200);
        expect(executionsRes.body.data.length).toBeGreaterThan(0);
    });
});

describe("Workflow Hook - Multiple Modifications", () => {
    test("should handle multiple nodes modifying data", async () => {
        // Use a different collection to avoid interference from other tests
        const multiTestCollection = "test_MultiModify";

        // Create test collection
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: multiTestCollection,
                schema: {
                    name: "MultiModifyProduct",
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
                        description: {
                            type: "TEXT",
                            allowNull: true,
                        },
                    },
                },
            });

        // Create workflow with multiple modifying nodes
        const workflow = {
            id: "hook-multi-modify",
            name: "Multi Node Modification",
            description: "Test workflow for items.create",
            status: "active",
            trigger_type: "hook",
            trigger_hook_collection: multiTestCollection,
            trigger_hook_action: "items.create",
            flow_data: {
                nodes: [
                    {
                        id: "trigger-1",
                        type: "trigger",
                        data: { label: "Trigger" },
                        position: { x: 100, y: 100 },
                    },
                    {
                        id: "script-1",
                        type: "script",
                        data: {
                            label: "First Modification",
                            script: `
                                return {
                                    data: {
                                        ...trigger.data,
                                        category: 'Modified1'
                                    }
                                };
                            `,
                        },
                        position: { x: 300, y: 100 },
                    },
                    {
                        id: "script-2",
                        type: "script",
                        data: {
                            label: "Second Modification",
                            script: `
                                // Get the output from script-1
                                const previousData = context.outputs['script-1']?.result?.data || trigger.data;
                                return {
                                    data: {
                                        ...previousData,
                                        category: 'Modified2',
                                        description: 'Second node'
                                    }
                                };
                            `,
                        },
                        position: { x: 500, y: 100 },
                    },
                ],
                edges: [
                    { id: "e1", source: "trigger-1", target: "script-1" },
                    { id: "e2", source: "script-1", target: "script-2" },
                ],
            },
        };

        const workflowRes = await request(app)
            .post("/items/baasix_Workflow")
            .set("Authorization", `Bearer ${adminToken}`)
            .send(workflow);

        expect(workflowRes.status).toBe(201);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create product
        const createRes = await request(app)
            .post(`/items/${multiTestCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Multi Modify Test",
                price: "75",
                category: "Original",
            });

        if (createRes.status !== 201) {
            console.log("ERROR creating product:", JSON.stringify(createRes.body, null, 2));
        }
        expect(createRes.status).toBe(201);

        // Read and verify later node won
        const readRes = await request(app)
            .get(`/items/${multiTestCollection}/${createRes.body.data.id}`)
            .set("Authorization", `Bearer ${adminToken}`);

        if (!readRes.body.data) {
            console.log("ERROR: Read response has no data:", JSON.stringify(readRes.body, null, 2));
        }
        expect(readRes.body.data).toBeDefined();
        expect(readRes.body.data.category).toBe("Modified2");
        expect(readRes.body.data.description).toBe("Second node");
    });
});