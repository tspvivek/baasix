import request from 'supertest';
import { startServerForTesting, destroyAllTablesInDB } from '../baasix';
import fs from 'fs';
import path from 'path';

let app;
let adminToken;

async function runTests() {
    try {
        // Setup
        console.log("Starting server...");
        await destroyAllTablesInDB();
        app = await startServerForTesting();

        // Login as admin
        const adminLoginResponse = await request(app)
            .post("/auth/login")
            .send({ email: "admin@baasix.com", password: "admin@123" });
        adminToken = adminLoginResponse.body.token;
        console.log("Admin token received\n");

        // Test 1: Export initial permissions
        console.log("=== Test 1: Export Initial Permissions ===");
        const initialExportRes = await request(app)
            .get('/permissions-export')
            .set('Authorization', `Bearer ${adminToken}`);

        console.log("Initial export status:", initialExportRes.statusCode);

        let initialExport;
        if (Buffer.isBuffer(initialExportRes.body)) {
            initialExport = JSON.parse(initialExportRes.body.toString());
        } else if (typeof initialExportRes.body === 'string') {
            initialExport = JSON.parse(initialExportRes.body);
        } else {
            initialExport = initialExportRes.body;
        }

        console.log("✓ Initial export successful");
        console.log("  Roles:", initialExport.roles.length);
        const totalPerms = initialExport.roles.reduce((sum, role) => sum + (role.permissions?.length || 0), 0);
        console.log("  Total permissions:", totalPerms);

        // Test 2: Modify permissions and re-import
        console.log("\n=== Test 2: Modify and Re-import Permissions ===");

        // Modify the export data - add a new permission to admin role
        const modifiedExport = JSON.parse(JSON.stringify(initialExport));
        const adminRole = modifiedExport.roles.find(r => r.name === 'administrator');

        if (adminRole) {
            console.log("  Original admin permissions:", adminRole.permissions.length);

            // Add a new permission
            adminRole.permissions.push({
                collection: 'test_Collection',
                action: 'create',
                fields: ['*'],
                conditions: null,
                defaultValues: null,
                relConditions: null
            });

            console.log("  Modified admin permissions:", adminRole.permissions.length);

            // Save to temporary file
            const tempFile = '/tmp/test_permissions.json';
            fs.writeFileSync(tempFile, JSON.stringify(modifiedExport, null, 2));

            // Re-import
            const importRes = await request(app)
                .post('/permissions-import')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('rolesPermissions', tempFile);

            console.log("  Import status:", importRes.statusCode);
            console.log("  Import response:", JSON.stringify(importRes.body, null, 2));

            if (importRes.statusCode === 200) {
                console.log("✓ Import successful");
            } else {
                console.log("✗ Import failed");
            }
        }

        // Test 3: Export again and verify changes
        console.log("\n=== Test 3: Export and Verify Changes ===");
        const finalExportRes = await request(app)
            .get('/permissions-export')
            .set('Authorization', `Bearer ${adminToken}`);

        let finalExport;
        if (Buffer.isBuffer(finalExportRes.body)) {
            finalExport = JSON.parse(finalExportRes.body.toString());
        } else if (typeof finalExportRes.body === 'string') {
            finalExport = JSON.parse(finalExportRes.body);
        } else {
            finalExport = finalExportRes.body;
        }

        const finalAdminRole = finalExport.roles.find(r => r.name === 'administrator');
        if (finalAdminRole) {
            console.log("  Final admin permissions:", finalAdminRole.permissions.length);

            // Check if our new permission exists
            const hasNewPerm = finalAdminRole.permissions.some(p =>
                p.collection === 'test_Collection' && p.action === 'create'
            );

            if (hasNewPerm) {
                console.log("✓ New permission found in export");
            } else {
                console.log("✗ New permission NOT found in export");
            }
        }

        // Test 4: Preview import with changes
        console.log("\n=== Test 4: Preview Import with Changes ===");

        const modifiedExport2 = JSON.parse(JSON.stringify(finalExport));
        const adminRole2 = modifiedExport2.roles.find(r => r.name === 'administrator');

        if (adminRole2) {
            // Modify description
            adminRole2.description = "Modified admin description";

            // Remove one permission
            if (adminRole2.permissions.length > 0) {
                adminRole2.permissions.pop();
            }

            const tempFile2 = '/tmp/test_permissions2.json';
            fs.writeFileSync(tempFile2, JSON.stringify(modifiedExport2, null, 2));

            const previewRes = await request(app)
                .post('/permissions-preview-import')
                .set('Authorization', `Bearer ${adminToken}`)
                .attach('rolesPermissions', tempFile2);

            console.log("  Preview status:", previewRes.statusCode);
            console.log("  Preview response:", JSON.stringify(previewRes.body, null, 2));

            if (previewRes.statusCode === 200) {
                const changes = previewRes.body.changes;
                console.log("✓ Preview successful");
                console.log("  Modified roles:", changes.modified?.length || 0);
                console.log("  Unchanged roles:", changes.unchanged?.length || 0);
            }
        }

        console.log("\n=== All Tests Complete ===");
        process.exit(0);
    } catch (error) {
        console.error("Test error:", error);
        process.exit(1);
    }
}

runTests();
