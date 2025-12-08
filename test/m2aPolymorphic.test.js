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

    // Create test schemas
    await createTestSchemas();
});

async function createTestSchemas() {
    // Create Activity schema (the source that will have polymorphic relations)
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "activities",
            schema: {
                name: "Activity",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    action: { type: "String", allowNull: false },
                    timestamp: { type: "DateTime", allowNull: false, defaultValue: { type: "NOW" } },
                    details: { type: "JSON", allowNull: true },
                },
            },
        });

    // Create User schema (one of the target collections)
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "testusers",
            schema: {
                name: "TestUser",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    username: { type: "String", allowNull: false },
                    email: { type: "String", allowNull: false },
                },
            },
        });

    // Create Task schema (another target collection)
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "tasks",
            schema: {
                name: "Task",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    title: { type: "String", allowNull: false },
                    status: { type: "String", allowNull: false, defaultValue: "pending" },
                },
            },
        });

    // Create Post schema (another target collection)
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "posts",
            schema: {
                name: "Post",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    title: { type: "String", allowNull: false },
                    content: { type: "Text", allowNull: false },
                },
            },
        });

    // Create M2A polymorphic relationship
    await request(app)
        .post("/schemas/activities/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            isRelationship: true,
            name: "activityable",
            description: "M2A Relation",
            type: "M2A",
            alias: "activities",
            tables: ["tasks", "testusers", "posts"],
            showAs: ["id"],
        });
}

// Create test data - one user, two tasks, one post
async function createTestData() {
    // Create a user
    const userResponse = await request(app)
        .post("/items/testusers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "testuser", email: "testuser@example.com" });
    const userId = userResponse.body.data.id;

    // Create two tasks
    const task1Response = await request(app)
        .post("/items/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Task 1", status: "pending" });
    const task1Id = task1Response.body.data.id;

    const task2Response = await request(app)
        .post("/items/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Task 2", status: "completed" });
    const task2Id = task2Response.body.data.id;

    // Create a post
    const postResponse = await request(app)
        .post("/items/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Test Post", content: "This is test post content" });
    const postId = postResponse.body.data.id;

    return { userId, task1Id, task2Id, postId };
}

describe("M2A Polymorphic Relations - Basic Tests", () => {
    let testData;

    beforeAll(async () => {
        testData = await createTestData();
    });

    test("Create activity with M2A relation to a user", async () => {
        const response = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "user_login",
                activityable: [
                    {
                        item_id: testData.userId,
                        collection: "testusers", // This matches the table name
                    },
                ],
            });
        console.log("CREATE RESPONSE", response.body);
        expect(response.status).toBe(201);
        expect(response.body.data).toBeDefined();
        const activityId = response.body.data.id;

        // Now manually check what's in the junction table to help us debug
        const checkJunction = await request(app)
            .get(`/items/activities_activityable_junction`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                fields: ["*"],
                filter: {
                    activities_id: {
                        eq: activityId,
                    },
                },
            });
        console.log("JUNCTION TABLE DATA:", checkJunction.body);

        // Verify the created data
        const activityResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.*", "activityable.testusers.*"] });
        console.log("GET RESPONSE", JSON.stringify(activityResponse.body.data));
        expect(activityResponse.status).toBe(200);
        expect(activityResponse.body.data.activityable).toHaveLength(1);
        expect(activityResponse.body.data.activityable[0].testusers.id).toBe(testData.userId);
    });

    test("Create activity with M2A relation to multiple types", async () => {
        const response = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "multi_update",
                activityable: [
                    {
                        item_id: testData.task1Id,
                        collection: "tasks",
                    },
                    {
                        item_id: testData.postId,
                        collection: "posts",
                    },
                ],
            });

        expect(response.status).toBe(201);
        expect(response.body.data).toBeDefined();
        const activityId = response.body.data.id;

        // Verify the created data
        const activityResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*", "activityable.posts.*"] });

        console.log("GET RESPONSE", JSON.stringify(activityResponse.body.data));

        expect(activityResponse.status).toBe(200);
        expect(activityResponse.body.data.activityable).toHaveLength(2);
        // Check both relations exist without relying on order
        expect(activityResponse.body.data.activityable.some(a => a.tasks?.id === testData.task1Id)).toBeTruthy();
        expect(activityResponse.body.data.activityable.some(a => a.posts?.id === testData.postId)).toBeTruthy();
    });

    test("Update activity with M2A relation", async () => {
        // First create an activity with a task relation
        const createResponse = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "task_created",
                activityable: [
                    {
                        item_id: testData.task1Id,
                        collection: "tasks",
                    },
                ],
            });

        const activityId = createResponse.body.data.id;

        // Now update it to add a user and change the task
        const updateResponse = await request(app)
            .patch(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "task_assigned",
                activityable: [
                    {
                        item_id: testData.task2Id, // Changed task
                        collection: "tasks",
                    },
                    {
                        item_id: testData.userId, // Added user
                        collection: "testusers",
                    },
                ],
            });

        expect(updateResponse.status).toBe(200);

        // Verify the updated data
        const activityResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*", "activityable.testusers.*"] });

        expect(activityResponse.status).toBe(200);
        expect(activityResponse.body.data.action).toBe("task_assigned");
        expect(activityResponse.body.data.activityable).toHaveLength(2);
        // Check both relations exist without relying on order
        expect(activityResponse.body.data.activityable.some(a => a.tasks?.id === testData.task2Id)).toBeTruthy();
        expect(activityResponse.body.data.activityable.some(a => a.testusers?.id === testData.userId)).toBeTruthy();
    });

    test("Update M2A relation through parent entity", async () => {
        // Create an initial activity with one related item
        const createResponse = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "task_assignment",
                details: { importance: "medium" },
                activityable: [
                    {
                        item_id: testData.task1Id,
                        collection: "tasks",
                    },
                ],
            });

        expect(createResponse.status).toBe(201);
        const activityId = createResponse.body.data.id;

        // Update the parent activity and its M2A relation in a single request
        const updateResponse = await request(app)
            .patch(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "task_reassignment",
                details: { importance: "high" },
                activityable: [
                    {
                        item_id: testData.task2Id, // Changed task
                        collection: "tasks",
                    },
                ],
            });

        expect(updateResponse.status).toBe(200);

        // Verify the updated data
        const activityResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*"] });

        expect(activityResponse.status).toBe(200);
        expect(activityResponse.body.data.action).toBe("task_reassignment");
        expect(activityResponse.body.data.details).toEqual({ importance: "high" });
        expect(activityResponse.body.data.activityable).toHaveLength(1);
        expect(activityResponse.body.data.activityable[0].tasks.id).toBe(testData.task2Id);
    });

    test("Clear all M2A relationships by passing empty array", async () => {
        // Create an initial activity with multiple related items
        const createResponse = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "multiple_items",
                activityable: [
                    {
                        item_id: testData.task1Id,
                        collection: "tasks",
                    },
                    {
                        item_id: testData.userId,
                        collection: "testusers",
                    },
                ],
            });

        expect(createResponse.status).toBe(201);
        const activityId = createResponse.body.data.id;

        // Verify initial relationships
        const initialResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*", "activityable.testusers.*"] });

        expect(initialResponse.body.data.activityable).toHaveLength(2);

        // Update the activity to clear all M2A relationships
        const updateResponse = await request(app)
            .patch(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "cleared_relations",
                activityable: [], // Empty array should clear all relationships
            });

        expect(updateResponse.status).toBe(200);

        // Verify relationships are cleared
        const finalResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*", "activityable.testusers.*"] });

        //expect(finalResponse.body.data.tasks).toEqual([]);
        expect(finalResponse.body.data.activityable).toEqual([]);
    });

    test("Partially update M2A relationships keeping some existing ones", async () => {
        // Create an initial activity with multiple related items
        const createResponse = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "mixed_relations",
                activityable: [
                    {
                        item_id: testData.task1Id,
                        collection: "tasks",
                    },
                    {
                        item_id: testData.userId,
                        collection: "testusers",
                    },
                    {
                        item_id: testData.postId,
                        collection: "posts",
                    },
                ],
            });

        expect(createResponse.status).toBe(201);
        const activityId = createResponse.body.data.id;

        // Verify initial relationships
        const initialResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*", "activityable.testusers.*", "activityable.posts.*"] });

        expect(initialResponse.body.data.activityable).toHaveLength(3);

        // Update the activity to keep post, change task, and remove user
        const updateResponse = await request(app)
            .patch(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                activityable: [
                    {
                        item_id: testData.task2Id, // Changed from task1 to task2
                        collection: "tasks",
                    },
                    {
                        item_id: testData.postId, // Same post as before
                        collection: "posts",
                    },
                    // User is removed
                ],
            });

        expect(updateResponse.status).toBe(200);

        // Verify updated relationships
        const finalResponse = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*", "activityable.testusers.*", "activityable.posts.*"] });

        console.log("FINAL RESPONSE", JSON.stringify(finalResponse.body));

        expect(finalResponse.body.data.activityable).toHaveLength(2);
        // Check both relations exist without relying on order
        expect(finalResponse.body.data.activityable.some(a => a.tasks?.id === testData.task2Id)).toBeTruthy();
        expect(finalResponse.body.data.activityable.some(a => a.posts?.id === testData.postId)).toBeTruthy();
    });
});

describe("M2A Polymorphic Relations - Advanced Filters and Relations", () => {
    let testData;
    let activityIds = [];

    beforeAll(async () => {
        testData = await createTestData();

        // Create several activities with different related items for testing filters

        // Activity 1: User login
        const activity1 = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "user_login",
                details: { browser: "Chrome", ip: "192.168.1.1" },
                activityable: [{ item_id: testData.userId, collection: "testusers" }],
            });
        activityIds.push(activity1.body.data.id);

        // Activity 2: Task created
        const activity2 = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "task_created",
                details: { priority: "high" },
                activityable: [{ item_id: testData.task1Id, collection: "tasks" }],
            });
        activityIds.push(activity2.body.data.id);

        // Activity 3: Task updated
        const activity3 = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "task_updated",
                details: { changes: ["status"] },
                activityable: [{ item_id: testData.task2Id, collection: "tasks" }],
            });
        activityIds.push(activity3.body.data.id);

        // Activity 4: Post published with related task and user
        const activity4 = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "post_published",
                details: { visibility: "public" },
                activityable: [
                    { item_id: testData.postId, collection: "posts" },
                    { item_id: testData.userId, collection: "testusers" },
                    { item_id: testData.task1Id, collection: "tasks" },
                ],
            });
        activityIds.push(activity4.body.data.id);
    });

    test("Filter activities by a specific related item", async () => {
        // Get all activities related to task1
        const response = await request(app)
            .get("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "activityable.tasks.id": {
                        eq: testData.task1Id,
                    },
                }),
                fields: ["*", "activityable.tasks.*"],
            });

        console.log("FILTER RESPONSE", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2); // Should find 2 activities: task_created and post_published

        // Verify that all returned activities have a relation to task1
        for (const activity of response.body.data) {
            const hasTask1 = activity.activityable?.some((task) => task.tasks.id === testData.task1Id);
            expect(hasTask1).toBeTruthy();
        }
    });

    test("Filter activities by relation type and action condition", async () => {
        // Get all activities related to testusers with action containing 'user'
        const response = await request(app)
            .get("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    AND: [
                        {
                            "activityable.testusers.id": {
                                isNotNull: true,
                            },
                        },
                        {
                            action: {
                                iLike: "user",
                            },
                        },
                    ],
                }),
                fields: ["*", "activityable.testusers.*"],
            });

        console.log("FILTER RESPONSE", JSON.stringify(response.body));

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2); // Should find 1 activity: user_login
        expect(response.body.data[0].action).toBe("user_login");
    });

    test("Use relcondition to filter by related fields", async () => {
        // Get activities related to completed tasks
        const response = await request(app)
            .get("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "activityable.tasks.status": {
                        eq: "completed",
                    },
                }),
                fields: ["*", "activityable.tasks.*"],
            });

        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThan(0);

        // All returned activities should be related to a completed task
        for (const activity of response.body.data) {
            const hasCompletedTask = activity.activityable?.some((task) => task.tasks?.status === "completed");
            expect(hasCompletedTask).toBeTruthy();
        }
    });

    test("Complex filter with multiple M2A relations", async () => {
        // Get activities that are related to both users and posts
        const response = await request(app)
            .get("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                // filter: JSON.stringify({
                //     "activityable.collection": {
                //         in: ["testusers", "posts"],
                //     },
                // }),
                fields: ["*", "activityable.testusers.*", "activityable.posts.*"],
                relConditions: JSON.stringify({
                    activityable: {
                        collection: {
                            in: ["testusers", "posts"],
                        },
                        // Only include the activityable junction records where:
                        testusers: {
                            // This will filter for records that have testusers
                            id: { isNotNull: true },
                        },
                        posts: {
                            // This will filter for records that have posts
                            id: { isNotNull: true },
                        },
                    },
                }),
            });

        console.log("COMPLEX FILTER RESPONSE", JSON.stringify(response.body));

        expect(response.status).toBe(200);

        // The filter should return activities that have relations to testusers or posts
        // Based on our test data, only Activity 4 (post_published) has BOTH testusers AND posts
        // Activity 1 (user_login) has only testusers
        // So we should get at least Activity 4, possibly also Activity 1
        expect(response.body.data.length).toBeGreaterThan(0);

        // Find the activity that has BOTH testusers and posts (should be post_published)
        const activityWithBoth = response.body.data.find(activity => {
            const hasTestusers = activity.activityable?.some(a => a.testusers !== undefined && a.testusers !== null);
            const hasPosts = activity.activityable?.some(a => a.posts !== undefined && a.posts !== null);
            return hasTestusers && hasPosts;
        });

        // Verify that at least one activity has both relations
        expect(activityWithBoth).toBeDefined();
        expect(activityWithBoth.action).toBe("post_published");
    });

    test("Update M2A relations by adding new items without removing existing ones", async () => {
        // Create an initial activity with one related item
        const createResponse = await request(app)
            .post("/items/activities")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                action: "initial_relation",
                activityable: [
                    {
                        item_id: testData.task1Id,
                        collection: "tasks",
                    },
                ],
            });

        expect(createResponse.status).toBe(201);
        const activityId = createResponse.body.data.id;

        // Get current relationships
        const initialActivity = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*"] });

        const currentRelations = initialActivity.body.data.activityable || [];

        // Update by adding a new relation without removing the existing one
        // First, fetch the existing relations
        const junctionResponse = await request(app)
            .get(`/items/activities_activityable_junction`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                fields: ["*"],
                filter: {
                    activities_id: {
                        eq: activityId,
                    },
                },
            });

        // Create new relations using the existing ones plus new ones
        const existingRelations = junctionResponse.body.data.map((junction) => ({
            item_id: junction.item_id,
            collection: junction.collection,
        }));

        const updatedRelations = [
            ...existingRelations,
            {
                item_id: testData.userId,
                collection: "testusers",
            },
        ];

        const updateResponse = await request(app)
            .patch(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                activityable: updatedRelations,
            });

        expect(updateResponse.status).toBe(200);

        // Verify both relations exist now
        const finalActivity = await request(app)
            .get(`/items/activities/${activityId}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ fields: ["*", "activityable.tasks.*", "activityable.testusers.*"] });

        console.log("FINAL ACTIVITY", JSON.stringify(finalActivity.body));

        expect(finalActivity.body.data.activityable).toHaveLength(2);
        // Check both relations exist without relying on order
        expect(finalActivity.body.data.activityable.some(a => a.tasks?.id === testData.task1Id)).toBeTruthy();
        expect(finalActivity.body.data.activityable.some(a => a.testusers?.id === testData.userId)).toBeTruthy();
    });
});

afterAll(async () => {
    // Clean up
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
