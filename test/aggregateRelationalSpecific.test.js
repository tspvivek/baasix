import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";
import ItemsService from "../baasix/services/ItemsService.js";

let app;
let adminToken;

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;
});

afterAll(async () => {
    // Clean up
    if (app.server) {
        await new Promise((resolve) => app.server.close(resolve));
    }
});

describe("Specific Aggregate Query Test", () => {
    test("should replicate the exact issue with relational aggregate query", async () => {
        // First, let's get a real role ID from the system
        const rolesResponse = await request(app)
            .get("/items/baasix_Role")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ limit: 1 });

        expect(rolesResponse.status).toBe(200);
        expect(rolesResponse.body.data.length).toBeGreaterThan(0);
        
        const roleId = rolesResponse.body.data[0].id;
        console.log('Using role ID:', roleId);

        // Now test the exact query that's failing
        const response = await request(app)
            .get("/items/baasix_User")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({
                filter: JSON.stringify({
                    "userRoles.role_Id": roleId,
                    "status": {
                        eq: "active",
                    },
                }),
                aggregate: JSON.stringify({ ucount: { function: "count", field: "id" } }),
                limit: -1,
            });
        
        console.info('Response status:', response.status);
        console.info('Response body:', JSON.stringify(response.body, null, 2));
        
        if (response.status === 500) {
            console.log('Error occurred - this indicates the issue is still present');
        } else {
            expect(response.status).toBe(200);
            
            if (response.body.data && response.body.data.length > 0) {
                const firstRow = response.body.data[0];
                console.log('Result data:', JSON.stringify(firstRow, null, 2));
                expect(firstRow.ucount).toBeDefined();
                
                // Check if ID field is incorrectly included
                if (firstRow.id !== undefined) {
                    console.log('❌ ISSUE CONFIRMED: ID field is present in aggregate result');
                    console.log('This means the fix is not working for this specific filter syntax');
                } else {
                    console.log('✅ ID field is correctly NOT present');
                }
            }
        }
    });

    test("should test with ItemsService directly to see the exact SQL", async () => {
        try {
            // Get a real role ID
            const rolesResponse = await request(app)
                .get("/items/baasix_Role")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ limit: 1 });

            const roleId = rolesResponse.body.data[0].id;

            // Create ItemsService instance with proper authentication
            const usersService = new ItemsService('baasix_User', {
                schema: { permissions: {} },
                accountability: { 
                    user: { id: adminToken }, 
                    role: { id: roleId, name: 'administrator' }, 
                    permissions: {},
                    tenant: null 
                }
            });

            console.log('Testing with ItemsService directly...');
            
            const result = await usersService.readByQuery({
                filter: {
                    "userRoles.role_Id": roleId,
                    "status": {
                        eq: "active",
                    },
                },
                aggregate: { ucount: { function: "count", field: "id" } },
                limit: -1,
            });

            console.log('Direct ItemsService result:', JSON.stringify(result, null, 2));
            
            if (result.data && result.data.length > 0) {
                const firstRow = result.data[0];
                if (firstRow.id !== undefined) {
                    console.log('❌ ISSUE CONFIRMED: ID field is present');
                    console.log('The fix is not working for this specific relational filter syntax');
                } else {
                    console.log('✅ Fix is working correctly');
                }
            }

        } catch (error) {
            console.error('Direct ItemsService test failed:', error.message);
            // This might help us understand what's happening
        }
    });
});