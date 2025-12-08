// File: test/testSequencer.js

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Sequencer = require("@jest/test-sequencer").default;

class CustomSequencer extends Sequencer {
    /**
     * Sort test in specific order
     * 1. Schema tests (data structure)
     * 2. Auth tests (fundamental access)
     * 3. Permission tests (access control)
     * 4. Basic CRUD tests
     * 5. Advanced and relational tests
     * 6. Special feature tests
     */
    sort(tests) {
        // Test order definition - order is important to prevent deadlocks
        const testOrder = [
            // Schema and structure first
            "schema.test.js",
            "schemaFlags.test.js",
            "uniqueIndex.test.js",
            "defaultValues.test.js",

            // Core functionality second
            "permission.test.js",
            "file.test.js",

            // Basic item operations
            "item.test.js",
            "itemconditions.test.js",
            "itemadv.test.js",

            // Search and filtering
            "search.test.js",
            "complexFilter.test.js",
            "sort.test.js",
            "aggregate.test.js",

            // Relations
            "onDelete.test.js",
            "nestedRelations.test.js",
            "nestedHasMany.test.js",
            "m2aPolymorphic.test.js",

            // Services and integrations
            "asset.test.js",
            "notification.test.js",
            "hooks.test.js",

            // Advanced features
            "dynamic.test.js",
            "endpoint.test.js",
            "multitenant.test.js",
            "postgis.test.js",
            "clinic.test.js",
            "auth.test.js",
        ];

        // Custom sorting function
        return tests.sort((testA, testB) => {
            const fileNameA = testA.path.split("/").pop();
            const fileNameB = testB.path.split("/").pop();

            const indexA = testOrder.indexOf(fileNameA);
            const indexB = testOrder.indexOf(fileNameB);

            // If both files are in the order list, sort by their position
            if (indexA !== -1 && indexB !== -1) {
                return indexA - indexB;
            }

            // If only one file is in the order list, prioritize it
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;

            // For files not in the order list, maintain their original order
            return 0;
        });
    }
}

export default CustomSequencer;
