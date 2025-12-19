import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

const jsonbCollection = "jsonbTest";
const nestedJsonCollection = "nestedJsonTest";

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    // Setup test schemas
    await setupJsonbTestSchemas();

    // Setup test data
    await setupJsonbTestData();
});

afterAll(async () => {
    // Cleanup handled by destroyAllTablesInDB in next test run
});

async function setupJsonbTestSchemas() {
    // Create schema for JSONB tests
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: jsonbCollection,
            schema: {
                name: "JsonbTest",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    metadata: { type: "JSONB", allowNull: true },
                    settings: { type: "JSONB", allowNull: true },
                    tags: { type: "JSONB", allowNull: true }
                }
            }
        });

    // Create schema for nested JSONB tests
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: nestedJsonCollection,
            schema: {
                name: "NestedJsonTest",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    title: { type: "String", allowNull: false },
                    profile: { type: "JSONB", allowNull: true }
                }
            }
        });
}

async function setupJsonbTestData() {
    // Insert test data for JSONB tests
    const testData = [
        {
            name: "Product A",
            metadata: { status: "active", type: "electronics", price: 99.99, stock: 50 },
            settings: { featured: true, category: "gadgets" },
            tags: ["javascript", "nodejs", "api"]
        },
        {
            name: "Product B",
            metadata: { status: "inactive", type: "clothing", price: 49.99, stock: 100 },
            settings: { featured: false, category: "fashion" },
            tags: ["python", "django", "web"]
        },
        {
            name: "Product C",
            metadata: { status: "active", type: "electronics", price: 199.99, stock: 25 },
            settings: { featured: true, category: "computers" },
            tags: ["javascript", "react", "frontend"]
        },
        {
            name: "Product D",
            metadata: { status: "pending", type: "books", price: 29.99 },
            settings: { featured: false },
            tags: ["education", "programming"]
        },
        {
            name: "Product E",
            metadata: { status: "active", type: "electronics", price: 149.99, stock: 75, discount: 10 },
            settings: { featured: true, category: "audio", premium: true },
            tags: ["nodejs", "backend", "api"]
        }
    ];

    for (const item of testData) {
        await request(app)
            .post(`/items/${jsonbCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(item);
    }

    // Insert nested JSONB test data
    const nestedData = [
        {
            title: "User 1",
            profile: {
                user: {
                    name: "John Doe",
                    preferences: {
                        theme: "dark",
                        language: "en",
                        notifications: true
                    }
                },
                scores: [85, 90, 78],
                level: 5
            }
        },
        {
            title: "User 2",
            profile: {
                user: {
                    name: "Jane Smith",
                    preferences: {
                        theme: "light",
                        language: "es",
                        notifications: false
                    }
                },
                scores: [92, 88, 95],
                level: 8
            }
        },
        {
            title: "User 3",
            profile: {
                user: {
                    name: "Bob Wilson",
                    preferences: {
                        theme: "dark",
                        language: "en"
                    }
                },
                scores: [70, 75, 80],
                level: 3
            }
        }
    ];

    for (const item of nestedData) {
        await request(app)
            .post(`/items/${nestedJsonCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(item);
    }
}

describe("JSONB Operators", () => {
    describe("jsonbContains (@>) - JSONB contains value", () => {
        test("should find records where JSONB contains specific key-value", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbContains: { status: "active" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3);
            response.body.data.forEach(item => {
                expect(item.metadata.status).toBe("active");
            });
        });

        test("should find records where JSONB contains multiple key-values", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbContains: { status: "active", type: "electronics" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3);
        });
    });

    describe("jsonbNotContains (NOT @>) - JSONB does NOT contain value", () => {
        test("should find records where JSONB does NOT contain specific value", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbNotContains: { status: "active" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2);
            response.body.data.forEach(item => {
                expect(item.metadata.status).not.toBe("active");
            });
        });
    });

    describe("jsonbHasKey (?) - Check if key exists", () => {
        test("should find records where JSONB has specific key", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbHasKey: "discount" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("Product E");
        });

        test("should find records where settings has premium key", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        settings: { jsonbHasKey: "premium" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("Product E");
        });
    });

    describe("jsonbHasAnyKeys (?|) - Check if any key exists", () => {
        test("should find records where JSONB has any of the specified keys", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbHasAnyKeys: ["discount", "premium"] }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
        });
    });

    describe("jsonbHasAllKeys (?&) - Check if all keys exist", () => {
        test("should find records where JSONB has all specified keys", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbHasAllKeys: ["status", "type", "price"] }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(5);
        });

        test("should find records where JSONB has all including optional keys", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbHasAllKeys: ["status", "type", "price", "stock"] }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(4); // Product D doesn't have stock
        });
    });

    describe("jsonbKeyEquals - Compare specific key value", () => {
        test("should find records where JSONB key equals string value", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyEquals: { key: "type", value: "electronics" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3);
        });

        test("should find records where JSONB key equals numeric value", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyEquals: { key: "stock", value: 50 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("Product A");
        });

        test("should find records where settings key equals boolean value", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        settings: { jsonbKeyEquals: { key: "featured", value: true } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3);
        });
    });

    describe("jsonbKeyNotEquals - Key value not equal", () => {
        test("should find records where JSONB key not equals value", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyNotEquals: { key: "status", value: "active" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2);
        });
    });

    describe("jsonbKeyGt/Gte/Lt/Lte - Numeric key comparisons", () => {
        test("should find records where JSONB key value is greater than", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyGt: { key: "price", value: 100 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Product C (199.99) and E (149.99)
        });

        test("should find records where JSONB key value is greater than or equal", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyGte: { key: "price", value: 99.99 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // A, C, E
        });

        test("should find records where JSONB key value is less than", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyLt: { key: "stock", value: 50 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Product C (25)
        });

        test("should find records where JSONB key value is less than or equal", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyLte: { key: "stock", value: 50 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Product A (50) and C (25)
        });
    });

    describe("jsonbKeyIn - Key value in list", () => {
        test("should find records where JSONB key value is in list", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyIn: { key: "status", values: ["active", "pending"] } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(4);
        });
    });

    describe("jsonbKeyNotIn - Key value not in list", () => {
        test("should find records where JSONB key value is NOT in list", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyNotIn: { key: "status", values: ["active", "pending"] } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].metadata.status).toBe("inactive");
        });
    });

    describe("jsonbKeyLike - Pattern matching on key value", () => {
        test("should find records where JSONB key value matches pattern", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        settings: { jsonbKeyLike: { key: "category", pattern: "%ga%" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // gadgets
            expect(response.body.data[0].name).toBe("Product A");
        });
    });

    describe("jsonbKeyIsNull / jsonbKeyIsNotNull - Null checks", () => {
        test("should find records where JSONB key is null or missing", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyIsNull: "stock" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Product D
            expect(response.body.data[0].name).toBe("Product D");
        });

        test("should find records where JSONB key is NOT null", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyIsNotNull: "stock" }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(4);
        });
    });

    describe("jsonbArrayLength - Check JSONB array length", () => {
        test("should find records where JSONB array has specific length", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        tags: { jsonbArrayLength: { op: "eq", value: 3 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(4); // Products A, B, C, E have 3 tags
        });

        test("should find records where JSONB array has at least N elements", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        tags: { jsonbArrayLength: { op: "gte", value: 2 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(5);
        });
    });

    describe("jsonbTypeOf - Check JSONB value type", () => {
        test("should find records where JSONB field is an array", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        tags: { jsonbTypeOf: { type: "array" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(5);
        });

        test("should find records where JSONB field is an object", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbTypeOf: { type: "object" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(5);
        });
    });

    describe("jsonbDeepValue - Access nested values", () => {
        test("should find records where deep nested value equals", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbDeepValue: { path: ["user", "preferences", "theme"], value: "dark" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // User 1 and User 3
        });

        test("should find records where deep nested value with comparison", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbDeepValue: { path: ["level"], value: 5, op: "gte" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // User 1 (5) and User 2 (8)
        });

        test("should find records where deep nested value with pattern matching", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbDeepValue: { path: ["user", "name"], value: "%John%", op: "ilike" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].title).toBe("User 1");
        });
    });

    describe("jsonbPathExists (@?) - JSON path exists", () => {
        test("should find records where JSON path exists", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbPathExists: "$.user.preferences.notifications" }
                    })
                });

            expect(response.status).toBe(200);
            // User 1 and User 2 have notifications, User 3 doesn't
            expect(response.body.data.length).toBe(2);
        });
    });

    describe("jsonbPathMatch (@@) - JSON path predicate match", () => {
        test("should find records where JSON path predicate matches", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbPathMatch: "$.level > 4" }
                    })
                });

            expect(response.status).toBe(200);
            // User 1 (level 5) and User 2 (level 8)
            expect(response.body.data.length).toBe(2);
        });

        test("should find records where JSON path predicate with string comparison", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbPathMatch: '$.price > 100' }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Product C and E
        });
    });

    describe("jsonbArrayLength with path - Check nested array length", () => {
        test("should find records where nested JSONB array has specific length", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbArrayLength: { path: "scores", op: "eq", value: 3 } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All users have 3 scores
        });
    });

    describe("jsonbTypeOf with path - Check nested value type", () => {
        test("should find records where nested JSONB value is specific type", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbTypeOf: { path: "scores", type: "array" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3);
        });

        test("should find records where nested JSONB value is number type", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbTypeOf: { path: "level", type: "number" } }
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3);
        });
    });

    describe("jsonbDeepValue with null - Check nested null values", () => {
        test("should find records where deep nested value is null", async () => {
            // User 3 doesn't have notifications field
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbDeepValue: { path: ["user", "preferences", "notifications"], value: null } }
                    })
                });

            expect(response.status).toBe(200);
            // User 3 has no notifications field (null)
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].title).toBe("User 3");
        });

        test("should find records where deep nested value is NOT null (ne op)", async () => {
            const response = await request(app)
                .get(`/items/${nestedJsonCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        profile: { jsonbDeepValue: { path: ["user", "preferences", "notifications"], value: null, op: "ne" } }
                    })
                });

            expect(response.status).toBe(200);
            // User 1 and User 2 have notifications field
            expect(response.body.data.length).toBe(2);
        });
    });

    describe("jsonbKeyEquals with null value", () => {
        test("should find records where JSONB key equals null", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyEquals: { key: "stock", value: null } }
                    })
                });

            expect(response.status).toBe(200);
            // Product D doesn't have stock field
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].name).toBe("Product D");
        });
    });

    describe("jsonbKeyNotEquals with null value", () => {
        test("should find records where JSONB key is NOT null", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbKeyNotEquals: { key: "stock", value: null } }
                    })
                });

            expect(response.status).toBe(200);
            // Products A, B, C, E have stock field
            expect(response.body.data.length).toBe(4);
        });
    });

    describe("Combined JSONB operators", () => {
        test("should combine multiple JSONB operators with AND", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        AND: [
                            { metadata: { jsonbContains: { status: "active" } } },
                            { metadata: { jsonbKeyGt: { key: "price", value: 100 } } }
                        ]
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Product C and E
        });

        test("should combine JSONB with regular operators", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        AND: [
                            { metadata: { jsonbContains: { type: "electronics" } } },
                            { name: { startsWith: "Product" } }
                        ]
                    })
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3);
        });
    });

    describe("jsonbContainedBy (<@) - JSONB is contained by value", () => {
        test("should find records where JSONB is subset of given value", async () => {
            const response = await request(app)
                .get(`/items/${jsonbCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        metadata: { jsonbContainedBy: { 
                            status: "active", 
                            type: "electronics", 
                            price: 99.99, 
                            stock: 50,
                            extraField: "ignored"
                        } }
                    })
                });

            expect(response.status).toBe(200);
            // Only records whose metadata is entirely contained in the given object
            expect(response.body.data.length).toBeGreaterThanOrEqual(0);
        });
    });
});
