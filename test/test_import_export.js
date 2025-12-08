import request from 'supertest';
import { startServerForTesting, destroyAllTablesInDB } from '../baasix';

let app;
let adminToken;

async function runTests() {
    try {
        console.log("Starting server...");
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin
        console.log("Logging in as admin...");
        const loginRes = await request(app)
            .post('/auth/login')
            .send({ email: 'admin@baasix.com', password: 'admin@123' });
        
        adminToken = loginRes.body.token;
        console.log("Admin token received");

        // Test 1: Schema Export
        console.log("\n=== Test 1: Schema Export ===");
        const schemaExportRes = await request(app)
            .get('/schemas-export')
            .set('Authorization', `Bearer ${adminToken}`);
        
        console.log("Schema export status:", schemaExportRes.statusCode);
        if (schemaExportRes.statusCode === 200) {
            // Response body may be a Buffer, string, or object
            let exportData;
            if (Buffer.isBuffer(schemaExportRes.body)) {
                exportData = JSON.parse(schemaExportRes.body.toString());
            } else if (typeof schemaExportRes.body === 'string') {
                exportData = JSON.parse(schemaExportRes.body);
            } else {
                exportData = schemaExportRes.body;
            }
            console.log("✓ Schema export successful");
            console.log("  Exported", exportData.schemas.length, "schemas");
        } else {
            console.log("✗ Schema export failed:", schemaExportRes.body);
        }

        // Test 2: Workflow Export
        console.log("\n=== Test 2: Workflow Export ===");
        
        // Create a test workflow first
        const createWfRes = await request(app)
            .post('/items/baasix_Workflow')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                id: 'test-export-workflow',
                name: 'Test Export Workflow',
                status: 'active',
                trigger_type: 'manual',
                flow_data: {
                    nodes: [{ id: 'trigger-1', type: 'trigger', data: {} }],
                    edges: []
                }
            });
        
        const workflowId = createWfRes.body.data.id;
        console.log("Created test workflow:", workflowId);

        const workflowExportRes = await request(app)
            .post('/workflows/export')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ workflowIds: [workflowId] });
        
        console.log("Workflow export status:", workflowExportRes.statusCode);
        if (workflowExportRes.statusCode === 200) {
            console.log("✓ Workflow export successful");
            console.log("  Exported", workflowExportRes.body.data.workflows.length, "workflow(s)");
        } else {
            console.log("✗ Workflow export failed:", workflowExportRes.body);
        }

        // Test 3: Permissions Export
        console.log("\n=== Test 3: Permissions Export ===");
        const permExportRes = await request(app)
            .get('/permissions-export')
            .set('Authorization', `Bearer ${adminToken}`);
        
        console.log("Permissions export status:", permExportRes.statusCode);
        if (permExportRes.statusCode === 200) {
            // Response body may be a Buffer, string, or object
            let exportData;
            if (Buffer.isBuffer(permExportRes.body)) {
                exportData = JSON.parse(permExportRes.body.toString());
            } else if (typeof permExportRes.body === 'string') {
                exportData = JSON.parse(permExportRes.body);
            } else {
                exportData = permExportRes.body;
            }
            console.log("✓ Permissions export successful");
            console.log("  Exported", exportData.roles.length, "role(s)");
            const totalPermissions = exportData.roles.reduce((sum, role) => sum + (role.permissions?.length || 0), 0);
            console.log("  Exported", totalPermissions, "permission(s)");
        } else {
            console.log("✗ Permissions export failed:", permExportRes.body);
        }

        console.log("\n=== All Tests Complete ===");
        process.exit(0);
    } catch (error) {
        console.error("Test error:", error);
        process.exit(1);
    }
}

runTests();
