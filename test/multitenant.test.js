import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe, beforeEach } from "@jest/globals";

let app;
let adminToken;
let adminUserId;

// Variables to store tenant information
let tenant1;
let tenant2;
let tenant1AdminToken;
let tenant1UserToken;
let tenant2AdminToken;
let tenant2UserToken;

// For testing non-tenant-specific roles
let globalRoleId;
let globalUserToken;
let globalUserId;
let tenant1UserRoleId;
let tenant1AdminRoleId;
let tenant2AdminRoleId;
let tenant2UserRoleId;
// For testing invites
let inviteToken;

beforeAll(async () => {
    // Destroy all tables to start with a clean slate
    await destroyAllTablesInDB();

    // Start the server with multi-tenant mode enabled
    app = await startServerForTesting({ envOverrides: { MULTI_TENANT: "true" } });

    // Login as the default admin to get the admin token
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });

    adminToken = adminLoginResponse.body.token;
    adminUserId = adminLoginResponse.body.user.id;

    // Create two tenants for testing
    await createTestTenants();

    // Create roles and users for testing
    await createTestRolesAndUsers();
});

async function createTestTenants() {
    // Create the first test tenant
    const tenant1Response = await request(app)
        .post("/items/baasix_Tenant")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Tenant 1" });
    tenant1 = tenant1Response.body.data;

    // Create the second test tenant
    const tenant2Response = await request(app)
        .post("/items/baasix_Tenant")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Tenant 2" });
    tenant2 = tenant2Response.body.data;
}

async function createTestRolesAndUsers() {
    // Create a global (non-tenant-specific) role
    const globalRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "global_role",
            description: "Global Role (non-tenant-specific)",
            isTenantSpecific: false,
        });
    if (globalRoleResponse.status !== 201) {
        console.error("Failed to create global role:", globalRoleResponse.status, globalRoleResponse.body);
    }
    globalRoleId = globalRoleResponse.body.data.id;

    // Create tenant-specific roles
    const tenant1AdminRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "tenant1_admin",
            description: "Admin for Tenant 1",
            isTenantSpecific: true,
            // Admin can invite users with user role
            canInviteRoleIds: [], // Will be updated after user role is created
        });
    tenant1AdminRoleId = tenant1AdminRoleResponse.body.data.id;

    const tenant2AdminRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "tenant2_admin",
            description: "Admin for Tenant 2",
            isTenantSpecific: true,
        });
    tenant2AdminRoleId = tenant2AdminRoleResponse.body.data.id;

    // Create a user role for each tenant
    const tenant1UserRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "tenant1_user",
            description: "User for Tenant 1",
            isTenantSpecific: true,
        });
    tenant1UserRoleId = tenant1UserRoleResponse.body.data.id;

    // Update admin role to allow inviting users with user role
    const updateRoleResponse = await request(app)
        .patch(`/items/baasix_Role/${tenant1AdminRoleId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            canInviteRoleIds: [tenant1UserRoleId],
        });
    if (updateRoleResponse.status !== 200 && updateRoleResponse.status !== 204) {
        console.error("Failed to update tenant1_admin role:", updateRoleResponse.status, updateRoleResponse.body);
    }

    const tenant2UserRoleResponse = await request(app)
        .post("/items/baasix_Role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "tenant2_user",
            description: "User for Tenant 2",
            isTenantSpecific: true,
        });
    tenant2UserRoleId = tenant2UserRoleResponse.body.data.id;

    // Also update tenant2 admin role
    await request(app)
        .patch(`/items/baasix_Role/${tenant2AdminRoleId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            canInviteRoleIds: [tenant2UserRoleId],
        });

    // Create users

    // Global (non-tenant-specific) user - create via API
    const globalUserResponse = await request(app)
        .post("/items/baasix_User")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            firstName: "Global",
            lastName: "User",
            email: "global.user@example.com",
            password: "password123",
        });
    globalUserId = globalUserResponse.body.data.id;

    // Directly assign the global role to the user
    await request(app)
        .post("/items/baasix_UserRole")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            user_Id: globalUserId,
            role_Id: globalRoleId,
            tenant_Id: null,
        });

    // Create admin users for each tenant
    const tenant1AdminResponse = await request(app)
        .post("/auth/register")
        .send({
            firstName: "Admin",
            lastName: "Tenant1",
            email: "admin.tenant1@example.com",
            password: "password123",
            tenant: { name: "Admin Tenant 1" },
        });

    console.info("tenant1AdminResponse", tenant1AdminResponse.body);

    const tenant2AdminResponse = await request(app)
        .post("/auth/register")
        .send({
            firstName: "Admin",
            lastName: "Tenant2",
            email: "admin.tenant2@example.com",
            password: "password123",
            tenant: { name: "Admin Tenant 2" },
        });

    console.info("tenant2AdminResponse", tenant2AdminResponse.body);

    // Create regular users for each tenant
    const tenant1UserResponse = await request(app)
        .post("/auth/register")
        .send({
            firstName: "User",
            lastName: "Tenant1",
            email: "user.tenant1@example.com",
            password: "password123",
            tenant: { name: "User Tenant 1" },
        });

    const tenant2UserResponse = await request(app)
        .post("/auth/register")
        .send({
            firstName: "User",
            lastName: "Tenant2",
            email: "user.tenant2@example.com",
            password: "password123",
            tenant: { name: "User Tenant 2" },
        });

    // Assign appropriate roles to users
    await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
        user_Id: tenant1AdminResponse.body.user.id,
        role_Id: tenant1AdminRoleId,
        tenant_Id: tenant1.id,
    });

    await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
        user_Id: tenant2AdminResponse.body.user.id,
        role_Id: tenant2AdminRoleId,
        tenant_Id: tenant2.id,
    });

    // Login with the created users to get tokens
    const globalUserLoginResponse = await request(app).post("/auth/login").send({
        email: "global.user@example.com",
        password: "password123",
    });
    globalUserToken = globalUserLoginResponse.body.token;

    const t1AdminLogin = await request(app).post("/auth/login").send({
        email: "admin.tenant1@example.com",
        password: "password123",
        tenant_Id: tenant1.id,
    });
    tenant1AdminToken = t1AdminLogin.body.token;

    const t2AdminLogin = await request(app).post("/auth/login").send({
        email: "admin.tenant2@example.com",
        password: "password123",
        tenant_Id: tenant2.id,
    });
    tenant2AdminToken = t2AdminLogin.body.token;

    const t1UserLogin = await request(app).post("/auth/login").send({
        email: "user.tenant1@example.com",
        password: "password123",
    });
    tenant1UserToken = t1UserLogin.body.token;

    const t2UserLogin = await request(app).post("/auth/login").send({
        email: "user.tenant2@example.com",
        password: "password123",
    });
    tenant2UserToken = t2UserLogin.body.token;

    // Add necessary permissions
    await createTestPermissions(
        globalRoleId,
        tenant1AdminRoleId,
        tenant2AdminRoleId,
        tenant1UserRoleId,
        tenant2UserRoleId
    );
}

async function createTestPermissions(globalRoleId, t1AdminRoleId, t2AdminRoleId, t1UserRoleId, t2UserRoleId) {
    // Create test schemas first
    await createTestSchemas();

    // Setup permissions for global role (CRUD on all collections)
    const collections = ["products", "orders"];

    for (const collection of collections) {
        const actions = ["create", "read", "update", "delete"];
        for (const action of actions) {
            await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
                role_Id: globalRoleId,
                collection,
                action,
                fields: "*",
            });
        }
    }

    // Setup permissions for tenant admins
    for (const collection of collections) {
        const actions = ["create", "read", "update", "delete"];
        for (const action of actions) {
            // For tenant 1 admin
            await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
                role_Id: t1AdminRoleId,
                collection,
                action,
                fields: "*",
            });

            // For tenant 2 admin
            await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
                role_Id: t2AdminRoleId,
                collection,
                action,
                fields: "*",
            });
        }

        // For tenant users - read only permissions
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: t1UserRoleId,
            collection,
            action: "read",
            fields: "*",
        });

        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: t2UserRoleId,
            collection,
            action: "read",
            fields: "*",
        });
    }

    // Add permissions for invite management to admin roles
    for (const adminRoleId of [t1AdminRoleId, t2AdminRoleId]) {
        // Allow admins to create and manage invites
        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: adminRoleId,
            collection: "baasix_Invite",
            action: "create",
            fields: "*",
        });

        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: adminRoleId,
            collection: "baasix_Invite",
            action: "read",
            fields: "*",
        });

        await request(app).post("/permissions").set("Authorization", `Bearer ${adminToken}`).send({
            role_Id: adminRoleId,
            collection: "baasix_Invite",
            action: "update",
            fields: "*",
        });
    }
}

async function createTestSchemas() {
    // Create a product schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "products",
            schema: {
                name: "Product",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    price: { type: "Double", allowNull: false },
                    description: { type: "Text", allowNull: true },
                    sku: { type: "String", allowNull: false },
                },
            },
        });

    await request(app)
        .post("/schemas/products/indexes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            fields: ["sku", "tenant_Id"],
            unique: true,
            name: "sku_unique",
        });

    // Create an order schema
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "orders",
            schema: {
                name: "Order",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    orderNumber: { type: "String", allowNull: false },
                    customerName: { type: "String", allowNull: false },
                    totalAmount: { type: "Double", allowNull: false },
                    status: { type: "String", allowNull: false, defaultValue: "pending" },
                },
            },
        });

    // Create relation between products and orders
    await request(app).post("/schemas/orders/relationships").set("Authorization", `Bearer ${adminToken}`).send({
        type: "M2M",
        target: "products",
        name: "products",
        alias: "orders",
    });
}

describe("Multi-tenant Tests", () => {
    describe("Non-tenant-specific versus Tenant-specific Roles", () => {
        test("A user with a non-tenant-specific role should be able to login without specifying a tenant", async () => {
            const response = await request(app).post("/auth/login").send({
                email: "global.user@example.com",
                password: "password123",
            });

            console.info("response", response.body);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("token");
            // Should not require a tenant (can be null or undefined)
            expect(response.body.tenant).toBeFalsy();
        });

        test("A user with a tenant-specific role must specify or default to a tenant", async () => {
            // Login with tenant-specific user - will default to their first tenant
            const loginResponse = await request(app).post("/auth/login").send({
                email: "user.tenant1@example.com",
                password: "password123",
            });

            console.info("loginResponse", loginResponse.body);

            expect(loginResponse.status).toBe(200);
            expect(loginResponse.body.tenant).not.toBeNull();
        });

        test("A user with both tenant-specific and non-tenant-specific roles can login with either", async () => {
            // Create a user with both role types
            const userResponse = await request(app)
                .post("/auth/register")
                .send({
                    firstName: "Dual",
                    lastName: "RoleUser",
                    email: "dual.role@example.com",
                    password: "password123",
                    tenant: { name: "Dual Role Tenant" },
                });

            // Assign a non-tenant-specific role
            await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
                user_Id: userResponse.body.user.id,
                role_Id: globalRoleId,
                tenant_Id: null,
            });

            // Also assign a tenant-specific role
            await request(app).post("/items/baasix_UserRole").set("Authorization", `Bearer ${adminToken}`).send({
                user_Id: userResponse.body.user.id,
                role_Id: tenant1UserRoleId,
                tenant_Id: tenant1.id,
            });

            // Should be able to login without a tenant (will use non-tenant-specific role)
            const loginWithoutTenantResponse = await request(app).post("/auth/login").send({
                email: "dual.role@example.com",
                password: "password123",
            });

            expect(loginWithoutTenantResponse.status).toBe(200);

            // Should also be able to login with a specific tenant
            const loginWithTenantResponse = await request(app).post("/auth/login").send({
                email: "dual.role@example.com",
                password: "password123",
                tenant_Id: tenant1.id,
            });

            expect(loginWithTenantResponse.status).toBe(200);
            expect(loginWithTenantResponse.body.tenant).not.toBeNull();
            expect(loginWithTenantResponse.body.tenant.id).toBe(tenant1.id);
        });
    });

    describe("User Registration in Multi-tenant Mode", () => {
        test("Registration requires a tenant object when multi-tenant is enabled", async () => {
            // Try registering without a tenant object
            const response = await request(app).post("/auth/register").send({
                firstName: "No",
                lastName: "Tenant",
                email: "no.tenant@example.com",
                password: "password123",
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toContain("Tenant information is required");
        });

        test("Registration succeeds with valid tenant object", async () => {
            const response = await request(app)
                .post("/auth/register")
                .send({
                    firstName: "New",
                    lastName: "Tenant",
                    email: "new.tenant@example.com",
                    password: "password123",
                    tenant: { name: "New User Tenant" },
                });

            expect(response.status).toBe(200);
            expect(response.body.tenant).toBeTruthy();
            expect(response.body.tenant.name).toBe("New User Tenant");
        });
    });

    describe("Invitation System", () => {
        test("Tenant admins can create invitations for allowed roles", async () => {
            // Tenant 1 admin creates an invitation for a user
            const response = await request(app)
                .post("/auth/invite")
                .set("Authorization", `Bearer ${tenant1AdminToken}`)
                .send({
                    email: "invited.user@example.com",
                    role_Id: tenant1UserRoleId,
                    tenant_Id: tenant1.id,
                    link: "http://localhost:3000",
                });

            expect(response.status).toBe(200);
            expect(response.body.message).toContain("Invitation sent successfully");

            // Store the invitation ID to test verification
            const responseInviteId = response.body.invite.id;

            // Get the invitation details to extract the token
            const getInviteResponse = await request(app)
                .get(`/items/baasix_Invite/${responseInviteId}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(getInviteResponse.status).toBe(200);
            inviteToken = getInviteResponse.body.data.token;
        });

        test("Invitations can be verified with token", async () => {
            const response = await request(app)
                .get(`/auth/verify-invite/${inviteToken}`)
                .query({ link: "http://localhost:3000" });

            expect(response.status).toBe(200);
            expect(response.body.valid).toBe(true);
            expect(response.body.email).toBe("invited.user@example.com");
            expect(response.body).toHaveProperty("tenant");
            expect(response.body).toHaveProperty("role");
            expect(response.body).toHaveProperty("acceptUrl");
            // User doesn't exist yet
            expect(response.body.userExists).toBe(false);
        });

        test("New users can register with invitation token", async () => {
            const response = await request(app).post("/auth/register").send({
                firstName: "Invited",
                lastName: "User",
                email: "invited.user@example.com",
                password: "password123",
                inviteToken,
            });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe("User registered successfully");
            expect(response.body.tenant).not.toBeNull();
            expect(response.body.tenant.id).toBe(tenant1.id);
        });

        test("Existing users can accept invitations to join another tenant", async () => {
            // Create an invitation for an existing user
            const inviteResponse = await request(app)
                .post("/auth/invite")
                .set("Authorization", `Bearer ${tenant2AdminToken}`)
                .send({
                    email: "invited.user@example.com", // Use the user we just created
                    role_Id: tenant2UserRoleId,
                    tenant_Id: tenant2.id,
                    link: "http://localhost:3000",
                });

            expect(inviteResponse.status).toBe(200);

            // Get the invitation details to extract the token
            const inviteId = inviteResponse.body.invite.id;
            const getInviteResponse = await request(app)
                .get(`/items/baasix_Invite/${inviteId}`)
                .set("Authorization", `Bearer ${adminToken}`);

            const newInviteToken = getInviteResponse.body.data.token;

            // Verify invite shows user exists
            const verifyResponse = await request(app).get(`/auth/verify-invite/${newInviteToken}`);

            expect(verifyResponse.status).toBe(200);
            expect(verifyResponse.body.userExists).toBe(true);

            // Login as the invited user
            const loginResponse = await request(app).post("/auth/login").send({
                email: "invited.user@example.com",
                password: "password123",
            });

            const invitedUserToken = loginResponse.body.token;

            // Accept the invitation
            const acceptResponse = await request(app)
                .post("/auth/accept-invite")
                .set("Authorization", `Bearer ${invitedUserToken}`)
                .send({
                    inviteToken: newInviteToken,
                });

            expect(acceptResponse.status).toBe(200);
            expect(acceptResponse.body.message).toBe("Invitation accepted successfully");
            expect(acceptResponse.body.tenant.id).toBe(tenant2.id);

            // Verify user now has access to both tenants
            const tenantsResponse = await request(app)
                .get("/auth/tenants")
                .set("Authorization", `Bearer ${acceptResponse.body.token}`);

            expect(tenantsResponse.status).toBe(200);
            expect(tenantsResponse.body.tenants.length).toBe(2);
        });

        test("Admins can only invite for roles they have permission for", async () => {
            // Create a new role that tenant1Admin doesn't have permission to invite
            const newRoleResponse = await request(app)
                .post("/items/baasix_Role")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "restricted_role",
                    description: "Role that requires special permission",
                    isTenantSpecific: true,
                });

            const restrictedRoleId = newRoleResponse.body.data.id;

            // Tenant admin tries to invite user with this role
            const response = await request(app)
                .post("/auth/invite")
                .set("Authorization", `Bearer ${tenant1AdminToken}`)
                .send({
                    email: "restricted.invite@example.com",
                    role_Id: restrictedRoleId,
                    tenant_Id: tenant1.id,
                    link: "http://localhost:3000",
                });

            expect(response.status).toBe(403);
            expect(response.body.message).toContain("don't have permission");
        });
    });

    describe("Tenant Access and Isolation", () => {
        test("Global admin should be able to see all tenants", async () => {
            const response = await request(app)
                .get("/items/baasix_Tenant")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(2);

            // Verify our created tenants are in the list
            const tenantNames = response.body.data.map((t) => t.name);
            expect(tenantNames).toContain("Tenant 1");
            expect(tenantNames).toContain("Tenant 2");
        });

        test("Users with tenant-specific roles should be able to switch between their assigned tenants", async () => {
            // Use the invited user who has access to both tenants
            const loginResponse = await request(app).post("/auth/login").send({
                email: "invited.user@example.com",
                password: "password123",
            });

            const multiTenantToken = loginResponse.body.token;

            // Get available tenants
            const tenantsResponse = await request(app)
                .get("/auth/tenants")
                .set("Authorization", `Bearer ${multiTenantToken}`);

            expect(tenantsResponse.status).toBe(200);
            expect(tenantsResponse.body.tenants.length).toBe(2);

            // Find the second tenant (not the current one)
            const currentTenantId = loginResponse.body.tenant.id;
            const otherTenant = tenantsResponse.body.tenants.find((t) => t.id !== currentTenantId);

            // Switch to the other tenant
            const switchResponse = await request(app)
                .post("/auth/switch-tenant")
                .set("Authorization", `Bearer ${multiTenantToken}`)
                .send({
                    tenant_Id: otherTenant.id,
                });

            expect(switchResponse.status).toBe(200);
            expect(switchResponse.body).toHaveProperty("token");
            expect(switchResponse.body.tenant.id).toBe(otherTenant.id);
        });

        test("Users with non-tenant-specific roles cannot switch tenants", async () => {
            // Try to switch tenant with a non-tenant-specific role user
            const switchResponse = await request(app)
                .post("/auth/switch-tenant")
                .set("Authorization", `Bearer ${globalUserToken}`)
                .send({
                    tenant_Id: tenant1.id,
                });

            console.info("switchResponse", switchResponse.body);

            expect(switchResponse.status).toBe(403);
            expect(switchResponse.body.message).toContain("Access denied for specified tenant");
        });
    });

    describe("Data Isolation Between Tenants", () => {
        beforeEach(async () => {
            // Clean up any existing test products
            await request(app)
                .delete("/items/products")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ filter: { name: { startsWith: "Test Product" } } });
        });

        test("Tenant 1 data should not be accessible by Tenant 2", async () => {
            // Create a product in Tenant 1
            const createResponse = await request(app)
                .post("/items/products")
                .set("Authorization", `Bearer ${tenant1AdminToken}`)
                .send({
                    name: "Test Product T1",
                    price: 99.99,
                    description: "Product for Tenant 1",
                    sku: "T1-PROD-001",
                });
            expect(createResponse.status).toBe(201);
            const productId = createResponse.body.data.id;

            // Verify Tenant 1 can read their product
            const tenant1ReadResponse = await request(app)
                .get(`/items/products/${productId}`)
                .set("Authorization", `Bearer ${tenant1AdminToken}`);
            expect(tenant1ReadResponse.status).toBe(200);
            expect(tenant1ReadResponse.body.data.name).toBe("Test Product T1");

            // Verify Tenant 2 cannot read Tenant 1's product
            const tenant2ReadResponse = await request(app)
                .get(`/items/products/${productId}`)
                .set("Authorization", `Bearer ${tenant2AdminToken}`);

            console.info("tenant2ReadResponse", tenant2ReadResponse.body);

            expect(tenant2ReadResponse.status).toBe(403);

            // Global admin should still be able to see the product
            const adminReadResponse = await request(app)
                .get(`/items/products/${productId}`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(adminReadResponse.status).toBe(200);
        });

        test("Tenants should be able to use the same unique values in their own contexts", async () => {
            // Create product with same SKU in both tenants
            const createT1Response = await request(app)
                .post("/items/products")
                .set("Authorization", `Bearer ${tenant1AdminToken}`)
                .send({
                    name: "Test Product Unique",
                    price: 55.55,
                    description: "Unique product test for Tenant 1",
                    sku: "SAME-SKU",
                });
            expect(createT1Response.status).toBe(201);

            // Same SKU should work for Tenant 2
            const createT2Response = await request(app)
                .post("/items/products")
                .set("Authorization", `Bearer ${tenant2AdminToken}`)
                .send({
                    name: "Test Product Unique",
                    price: 55.55,
                    description: "Unique product test for Tenant 2",
                    sku: "SAME-SKU",
                });
            expect(createT2Response.status).toBe(201);

            // But duplicate SKU within same tenant should fail
            const duplicateResponse = await request(app)
                .post("/items/products")
                .set("Authorization", `Bearer ${tenant1AdminToken}`)
                .send({
                    name: "Another Product",
                    price: 33.33,
                    description: "This should fail",
                    sku: "SAME-SKU",
                });
            expect(duplicateResponse.status).toBe(409);
        });
    });
});

afterAll(async () => {
    // Close the server
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});
