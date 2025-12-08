import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;
// Removed unused variables for cleaner code

// Test collection names for different array types
const stringArrayCollection = "stringArrayTest";
const integerArrayCollection = "integerArrayTest";  
const decimalArrayCollection = "decimalArrayTest";
const booleanArrayCollection = "booleanArrayTest";
const uuidArrayCollection = "uuidArrayTest";

beforeAll(async () => {
    await destroyAllTablesInDB();
    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app).post("/auth/login").send({
        email: "admin@baasix.com",
        password: "admin@123",
    });
    adminToken = adminLoginResponse.body.token;

    // Create a regular user (for potential future tests)
    await request(app).post("/auth/register").send({
        firstName: "Test",
        lastName: "User",
        email: "arraytest@test.com",
        password: "userpassword",
    });

    // Setup test schemas for different array types
    await setupArrayTestSchemas();
    
    // Setup relational schemas for testing array operators in relations
    await setupRelationalArraySchemas();
    
    // Setup test data
    await setupArrayTestData();
    
    // Setup relational test data
    await setupRelationalArrayData();
});

afterAll(async () => {
    // Cleanup handled by destroyAllTablesInDB in next test run
});

async function setupArrayTestSchemas() {
    // Create schema for string array tests
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: stringArrayCollection,
            schema: {
                name: "StringArrayTest",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    tags: { type: "Array_String", allowNull: true },
                    categories: { type: "Array_String", allowNull: true },
                    keywords: { type: "Array_String", allowNull: true }
                }
            }
        });

    // Create schema for integer array tests
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: integerArrayCollection,
            schema: {
                name: "IntegerArrayTest", 
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    scores: { type: "Array_Integer", allowNull: true },
                    ratings: { type: "Array_Integer", allowNull: true },
                    years: { type: "Array_Integer", allowNull: true }
                }
            }
        });

    // Create schema for decimal array tests  
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: decimalArrayCollection,
            schema: {
                name: "DecimalArrayTest",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    prices: { type: "Array_Decimal", allowNull: true },
                    percentages: { type: "Array_Decimal", allowNull: true },
                    weights: { type: "Array_Decimal", allowNull: true }
                }
            }
        });

    // Create schema for boolean array tests
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: booleanArrayCollection,
            schema: {
                name: "BooleanArrayTest",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    flags: { type: "Array_Boolean", allowNull: true },
                    permissions: { type: "Array_Boolean", allowNull: true },
                    settings: { type: "Array_Boolean", allowNull: true }
                }
            }
        });

    // Create schema for UUID array tests
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: uuidArrayCollection,
            schema: {
                name: "UuidArrayTest",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    userIds: { type: "Array_UUID", allowNull: true },
                    relatedIds: { type: "Array_UUID", allowNull: true },
                    parentIds: { type: "Array_UUID", allowNull: true }
                }
            }
        });
}

async function setupRelationalArraySchemas() {
    // Create Author schema with string arrays
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "authors",
            schema: {
                name: "Author",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    name: { type: "String", allowNull: false },
                    specialties: { type: "Array_String", allowNull: true },
                    skills: { type: "Array_String", allowNull: true }
                }
            }
        });

    // Create Article schema that belongs to Author
    await request(app)
        .post("/schemas")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            collectionName: "articles",
            schema: {
                name: "Article",
                fields: {
                    id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                    title: { type: "String", allowNull: false },
                    tags: { type: "Array_String", allowNull: true },
                    ratings: { type: "Array_Integer", allowNull: true },
                    author_id: { type: "UUID", allowNull: false }
                }
            }
        });

    // Create the relationship: Article belongs to Author  
    const relationshipResponse = await request(app)
        .post("/schemas/articles/relationships")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            type: "M2O",
            target: "authors",
            name: "author",
            alias: "articles"
        });
    
    console.log("Relationship creation response:", relationshipResponse.status, relationshipResponse.body);
}

async function setupRelationalArrayData() {
    // Create authors with different specialties
    const author1Response = await request(app)
        .post("/items/authors")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "John Tech Writer",
            specialties: ["javascript", "nodejs", "databases"],
            skills: ["programming", "technical-writing", "architecture"]
        });
    const author1Id = author1Response.body.data.id;

    const author2Response = await request(app)
        .post("/items/authors")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Jane Data Expert",
            specialties: ["python", "machine-learning", "data-science"],
            skills: ["analytics", "modeling", "visualization"]
        });
    const author2Id = author2Response.body.data.id;

    const author3Response = await request(app)
        .post("/items/authors")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Bob Full Stack",
            specialties: ["javascript", "react", "nodejs", "databases"],
            skills: ["frontend", "backend", "devops"]
        });
    const author3Id = author3Response.body.data.id;

    // Create articles by these authors
    console.log("Creating article with author_id:", author1Id);
    const article1Response = await request(app)
        .post("/items/articles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            title: "Advanced Node.js Patterns",
            tags: ["nodejs", "backend", "advanced"],
            ratings: [5, 4, 5, 4, 5],
            author_id: author1Id
        });
    console.log("Article 1 creation response:", article1Response.status, article1Response.body);

    await request(app)
        .post("/items/articles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            title: "Python ML Pipeline",
            tags: ["python", "machine-learning", "pipeline"],
            ratings: [4, 5, 4, 3, 4],
            author_id: author2Id
        });

    await request(app)
        .post("/items/articles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            title: "React Best Practices",
            tags: ["react", "frontend", "javascript"],
            ratings: [5, 5, 4, 5, 4],
            author_id: author3Id
        });

    await request(app)
        .post("/items/articles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            title: "Database Design Fundamentals",
            tags: ["databases", "design", "fundamentals"],
            ratings: [4, 4, 5, 4, 4],
            author_id: author1Id
        });
}

async function setupArrayTestData() {
    // Create string array test data
    const stringTestData = [
        {
            name: "Blog Post 1",
            tags: ["javascript", "nodejs", "backend"],
            categories: ["programming", "tutorial"],
            keywords: ["web", "development", "coding"]
        },
        {
            name: "Blog Post 2", 
            tags: ["python", "django", "web"],
            categories: ["programming", "framework"],
            keywords: ["backend", "api", "rest"]
        },
        {
            name: "Blog Post 3",
            tags: ["react", "frontend", "javascript"],
            categories: ["programming", "ui"],
            keywords: ["component", "state", "jsx"]
        }
    ];

    for (const data of stringTestData) {
        await request(app)
            .post(`/items/${stringArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(data);
    }

    // Create integer array test data
    const integerTestData = [
        {
            name: "Student 1",
            scores: [95, 87, 92, 88],
            ratings: [4, 5, 4, 3],
            years: [2020, 2021, 2022]
        },
        {
            name: "Student 2",
            scores: [78, 91, 85, 90],
            ratings: [3, 4, 4, 5], 
            years: [2019, 2020, 2021, 2022]
        },
        {
            name: "Student 3",
            scores: [88, 94, 87, 92],
            ratings: [4, 5, 3, 4],
            years: [2021, 2022, 2023]
        }
    ];

    for (const data of integerTestData) {
        await request(app)
            .post(`/items/${integerArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(data);
    }

    // Create decimal array test data
    const decimalTestData = [
        {
            name: "Product 1",
            prices: [19.99, 24.99, 29.99],
            percentages: [10.5, 15.75, 20.0],
            weights: [1.5, 2.25, 3.0]
        },
        {
            name: "Product 2",
            prices: [49.99, 59.99, 69.99],
            percentages: [25.5, 30.25, 35.0],
            weights: [5.5, 7.75, 10.0]
        },
        {
            name: "Product 3", 
            prices: [99.99, 109.99, 119.99],
            percentages: [40.5, 45.25, 50.0],
            weights: [12.5, 15.75, 18.0]
        }
    ];

    for (const data of decimalTestData) {
        await request(app)
            .post(`/items/${decimalArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(data);
    }

    // Create boolean array test data
    const booleanTestData = [
        {
            name: "User 1",
            flags: [true, false, true, false],
            permissions: [true, true, false],
            settings: [false, true, true, false]
        },
        {
            name: "User 2",
            flags: [false, true, false, true],
            permissions: [true, false, true],
            settings: [true, false, false, true]
        },
        {
            name: "User 3",
            flags: [true, true, false, false],
            permissions: [false, true, true],
            settings: [true, true, false, false]
        }
    ];

    for (const data of booleanTestData) {
        await request(app)
            .post(`/items/${booleanArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(data);
    }

    // For UUID arrays, we'll use some sample UUIDs
    const uuidTestData = [
        {
            name: "Entity 1",
            userIds: ["550e8400-e29b-41d4-a716-446655440001", "550e8400-e29b-41d4-a716-446655440002"],
            relatedIds: ["550e8400-e29b-41d4-a716-446655440010", "550e8400-e29b-41d4-a716-446655440011"], 
            parentIds: ["550e8400-e29b-41d4-a716-446655440020"]
        },
        {
            name: "Entity 2",
            userIds: ["550e8400-e29b-41d4-a716-446655440002", "550e8400-e29b-41d4-a716-446655440003"],
            relatedIds: ["550e8400-e29b-41d4-a716-446655440011", "550e8400-e29b-41d4-a716-446655440012"],
            parentIds: ["550e8400-e29b-41d4-a716-446655440021", "550e8400-e29b-41d4-a716-446655440022"]
        }
    ];

    for (const data of uuidTestData) {
        await request(app)
            .post(`/items/${uuidArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(data);
    }
}

describe("Array Contains Operator Tests", () => {
    describe("String Array Contains", () => {
        test("should find items where string array contains single value", async () => {
            const response = await request(app)
                .get(`/items/${stringArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "tags": { "arraycontains": "javascript" } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Blog Post 1 and 3 have javascript
            expect(response.body.data.every(item => item.tags.includes("javascript"))).toBe(true);
        });

        test("should find items where string array contains multiple values", async () => {
            const response = await request(app)
                .get(`/items/${stringArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "tags": { "arraycontains": ["javascript", "nodejs"] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Only Blog Post 1 has both
            expect(response.body.data[0].name).toBe("Blog Post 1");
        });

        test("should return empty result when no match found", async () => {
            const response = await request(app)
                .get(`/items/${stringArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "tags": { "arraycontains": "nonexistent" } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(0);
        });
    });

    describe("Integer Array Contains", () => {
        test("should find items where integer array contains single value", async () => {
            const response = await request(app)
                .get(`/items/${integerArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "scores": { "arraycontains": 95 } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Student 1 has score 95
            expect(response.body.data[0].name).toBe("Student 1");
        });

        test("should find items where integer array contains multiple values", async () => {
            const response = await request(app)
                .get(`/items/${integerArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "ratings": { "arraycontains": [4, 5] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All students have both 4 and 5 ratings
        });

        test("should handle integer arrays with year values", async () => {
            const response = await request(app)
                .get(`/items/${integerArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "years": { "arraycontains": 2022 } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All students have 2022
        });
    });

    describe("Decimal Array Contains", () => {
        test("should find items where decimal array contains single value", async () => {
            const response = await request(app)
                .get(`/items/${decimalArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "prices": { "arraycontains": 19.99 } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Product 1 has price 19.99
            expect(response.body.data[0].name).toBe("Product 1");
        });

        test("should find items where decimal array contains multiple values", async () => {
            const response = await request(app)
                .get(`/items/${decimalArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "percentages": { "arraycontains": [10.5, 15.75] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Product 1 has both percentages
            expect(response.body.data[0].name).toBe("Product 1");
        });

        test("should handle decimal precision correctly", async () => {
            const response = await request(app)
                .get(`/items/${decimalArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "weights": { "arraycontains": 2.25 } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Product 1 has weight 2.25
        });
    });

    describe("Boolean Array Contains", () => {
        test("should find items where boolean array contains true", async () => {
            const response = await request(app)
                .get(`/items/${booleanArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "flags": { "arraycontains": true } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All users have at least one true flag
        });

        test("should find items where boolean array contains false", async () => {
            const response = await request(app)
                .get(`/items/${booleanArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "flags": { "arraycontains": false } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All users have at least one false flag
        });

        test("should find items where boolean array contains both true and false", async () => {
            const response = await request(app)
                .get(`/items/${booleanArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "permissions": { "arraycontains": [true, false] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All users have both true and false
        });
    });

    describe("UUID Array Contains", () => {
        test("should find items where UUID array contains single UUID", async () => {
            const response = await request(app)
                .get(`/items/${uuidArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "userIds": { "arraycontains": "550e8400-e29b-41d4-a716-446655440001" } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Entity 1 has this UUID
            expect(response.body.data[0].name).toBe("Entity 1");
        });

        test("should find items where UUID array contains multiple UUIDs", async () => {
            const response = await request(app)
                .get(`/items/${uuidArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "userIds": { "arraycontains": ["550e8400-e29b-41d4-a716-446655440002"] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Both entities have this UUID
        });
    });
});

describe("Array Contained Operator Tests", () => {
    describe("String Array Contained", () => {
        test("should find items where given array contains all of the field array", async () => {
            const response = await request(app)
                .get(`/items/${stringArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "categories": { "arraycontained": ["programming", "tutorial", "framework", "ui", "extra"] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All posts have categories contained in the given array
        });

        test("should find items where field array is contained in given array", async () => {
            const response = await request(app)
                .get(`/items/${stringArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "tags": { "arraycontained": ["python", "django", "web", "javascript", "nodejs", "backend", "react", "frontend"] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All posts' tags are contained in this large array
        });
    });

    describe("Integer Array Contained", () => {
        test("should find items where given array contains all field values", async () => {
            const response = await request(app)
                .get(`/items/${integerArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "ratings": { "arraycontained": [1, 2, 3, 4, 5] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All ratings arrays are contained in [1,2,3,4,5]
        });
    });

    describe("Decimal Array Contained", () => {
        test("should find items where given decimal array contains all field values", async () => {
            const response = await request(app)
                .get(`/items/${decimalArrayCollection}`)
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "weights": { "arraycontained": [1.5, 2.25, 3.0, 5.5, 7.75, 10.0, 12.5, 15.75, 18.0] } 
                    }) 
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // All weight arrays are contained
        });
    });
});

describe("Array Operator Edge Cases", () => {
    test("should handle empty arrays in arraycontains", async () => {
        const response = await request(app)
            .get(`/items/${stringArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ 
                filter: JSON.stringify({ 
                    "tags": { "arraycontains": [] } 
                }) 
            });

        expect(response.status).toBe(200);
        // PostgreSQL array @> ARRAY[] should return all records (empty array is contained in any array)
        expect(response.body.data.length).toBe(3);
    });

    test("should handle null values gracefully", async () => {
        // Create an item with null array
        await request(app)
            .post(`/items/${stringArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Blog Post with null tags",
                tags: null,
                categories: ["test"],
                keywords: []
            });

        const response = await request(app)
            .get(`/items/${stringArrayCollection}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ 
                filter: JSON.stringify({ 
                    "tags": { "arraycontains": "javascript" } 
                }) 
            });

        expect(response.status).toBe(200);
        // Should not include the item with null tags
        expect(response.body.data.every(item => item.tags !== null)).toBe(true);
    });

    test("should handle mixed type arrays (via JSON field)", async () => {
        // Create a collection with JSON array field that can store mixed types
        await request(app)
            .post("/schemas")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                collectionName: "mixedArrayTest",
                schema: {
                    name: "MixedArrayTest",
                    fields: {
                        id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                        name: { type: "String", allowNull: false },
                        data: { type: "JSON", allowNull: true }
                    }
                }
            });

        // Create test data with JSON arrays
        await request(app)
            .post("/items/mixedArrayTest")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
                name: "Mixed Data",
                data: ["string", 123, true, 45.67]
            });

        // For JSON fields, we should use regular JSON operators, not array operators
        // This test shows that our array operators work properly by rejecting JSON fields
        const response = await request(app)
            .get("/items/mixedArrayTest")
            .set("Authorization", `Bearer ${adminToken}`)
            .query({ 
                filter: JSON.stringify({ 
                    "data": { "arraycontains": "string" } 
                }) 
            });

        // This should fail because JSON type can't be cast to text[] - this is expected behavior
        expect(response.status).toBe(500);
        expect(response.body.error.details).toContain("cannot cast type jsonb to text[]");
    });
});

describe("Relational Array Operator Tests", () => {
    describe("Array Contains in Related Fields", () => {
        test("should find articles where author specialties contain specific skill", async () => {
            const response = await request(app)
                .get("/items/articles")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "author.specialties": { "arraycontains": "javascript" } 
                    }),
                    fields: ["*", "author.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // Articles by John and Bob (both have javascript specialty)
            
            // Verify that all returned articles have authors with javascript specialty
            response.body.data.forEach(article => {
                expect(article.author.specialties).toContain("javascript");
            });
        });

        test("should find articles where author skills contain multiple values", async () => {
            const response = await request(app)
                .get("/items/articles")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "author.skills": { "arraycontains": ["programming", "technical-writing"] } 
                    }),
                    fields: ["*", "author.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2); // Only John's articles have both skills
            
            // Verify that returned articles are by John Tech Writer
            response.body.data.forEach(article => {
                expect(article.author.name).toBe("John Tech Writer");
                expect(article.author.skills).toEqual(expect.arrayContaining(["programming", "technical-writing"]));
            });
        });

        test("should find articles where author specialties contain database-related skills", async () => {
            const response = await request(app)
                .get("/items/articles")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "author.specialties": { "arraycontains": "databases" } 
                    }),
                    fields: ["*", "author.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(3); // Articles by John and Bob (both have databases specialty)
            
            // Verify articles are by authors who specialize in databases
            response.body.data.forEach(article => {
                expect(["John Tech Writer", "Bob Full Stack"]).toContain(article.author.name);
                expect(article.author.specialties).toContain("databases");
            });
        });

        test("should find articles where author skills are contained in given array", async () => {
            const response = await request(app)
                .get("/items/articles")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "author.skills": { "arraycontained": ["analytics", "modeling", "visualization", "extra", "skills"] } 
                    }),
                    fields: ["*", "author.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Only Jane's article (her skills are contained in the given array)
            
            // Verify it's Jane's article
            expect(response.body.data[0].author.name).toBe("Jane Data Expert");
        });

        test("should return empty when no relational array matches", async () => {
            const response = await request(app)
                .get("/items/articles")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        "author.specialties": { "arraycontains": "nonexistent-skill" } 
                    }),
                    fields: ["*", "author.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(0);
        });
    });

    describe("Array Contains with Article Arrays and Author Relations", () => {
        test("should combine article array filter with author relational array filter", async () => {
            const response = await request(app)
                .get("/items/articles")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({ 
                    filter: JSON.stringify({ 
                        AND: [
                            { "tags": { "arraycontains": "javascript" } },
                            { "author.specialties": { "arraycontains": "react" } }
                        ]
                    }),
                    fields: ["*", "author.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1); // Only Bob's React article matches both conditions
            
            const article = response.body.data[0];
            expect(article.title).toBe("React Best Practices");
            expect(article.tags).toContain("javascript");
            expect(article.author.specialties).toContain("react");
            expect(article.author.name).toBe("Bob Full Stack");
        });

        test("should filter articles by integer array in relation using arraycontains", async () => {
            // First let's create an author with integer array field for this test
            await request(app)
                .post("/schemas")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    collectionName: "publishers",
                    schema: {
                        name: "Publisher",
                        fields: {
                            id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                            name: { type: "String", allowNull: false },
                            yearsFunded: { type: "Array_Integer", allowNull: true }
                        }
                    }
                });

            // Create a relationship from articles to publishers
            await request(app)
                .post("/schemas/articles/relationships")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "M2O",
                    target: "publishers", 
                    name: "publisher",
                    alias: "publishedArticles"
                });

            // Create a publisher with specific years
            const publisherResponse = await request(app)
                .post("/items/publishers")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Tech Publications Inc",
                    yearsFunded: [2018, 2019, 2020, 2021, 2022]
                });

            // Update an article to have this publisher
            const articlesResponse = await request(app)
                .get("/items/articles")
                .set("Authorization", `Bearer ${adminToken}`);
            
            if (articlesResponse.body.data.length > 0) {
                const firstArticleId = articlesResponse.body.data[0].id;
                
                await request(app)
                    .patch(`/items/articles/${firstArticleId}`)
                    .set("Authorization", `Bearer ${adminToken}`)
                    .send({
                        publisher_id: publisherResponse.body.data.id
                    });

                // Now test the integer array contains in relation
                const response = await request(app)
                    .get("/items/articles")
                    .set("Authorization", `Bearer ${adminToken}`)
                    .query({ 
                        filter: JSON.stringify({ 
                            "publisher.yearsFunded": { "arraycontains": 2020 } 
                        }),
                        fields: ["*", "publisher.*"]
                    });

                expect(response.status).toBe(200);
                expect(response.body.data.length).toBe(1);
                expect(response.body.data[0].publisher.yearsFunded).toContain(2020);
            }
        });
    });
});

describe("Deep Relational Array Operator Tests", () => {
    describe("Multi-Level Relational Array Contains", () => {
        test("should setup deep relational schemas for testing", async () => {
            // Create Company schema  
            await request(app)
                .post("/schemas")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    collectionName: "companies",
                    schema: {
                        name: "Company",
                        fields: {
                            id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                            name: { type: "String", allowNull: false },
                            technologies: { type: "Array_String", allowNull: true },
                            markets: { type: "Array_String", allowNull: true }
                        }
                    }
                });

            // Create Department schema that belongs to Company
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
                            focuses: { type: "Array_String", allowNull: true },
                            company_id: { type: "UUID", allowNull: false }
                        }
                    }
                });

            // Create Employee schema that belongs to Department
            await request(app)
                .post("/schemas")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    collectionName: "employees",
                    schema: {
                        name: "Employee",
                        fields: {
                            id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                            name: { type: "String", allowNull: false },
                            skills: { type: "Array_String", allowNull: true },
                            certifications: { type: "Array_String", allowNull: true },
                            department_id: { type: "UUID", allowNull: false }
                        }
                    }
                });

            // Create Project schema that belongs to Employee
            await request(app)
                .post("/schemas")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    collectionName: "projects",
                    schema: {
                        name: "Project",
                        fields: {
                            id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
                            title: { type: "String", allowNull: false },
                            tags: { type: "Array_String", allowNull: true },
                            requirements: { type: "Array_String", allowNull: true },
                            employee_id: { type: "UUID", allowNull: false }
                        }
                    }
                });

            // Create relationships: Department -> Company
            await request(app)
                .post("/schemas/departments/relationships")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "M2O",
                    target: "companies",
                    name: "company",
                    alias: "departments"
                });

            // Create relationships: Employee -> Department
            await request(app)
                .post("/schemas/employees/relationships")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "M2O",
                    target: "departments",
                    name: "department",
                    alias: "employees"
                });

            // Create relationships: Project -> Employee
            await request(app)
                .post("/schemas/projects/relationships")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    type: "M2O",
                    target: "employees", 
                    name: "employee",
                    alias: "projects"
                });

            // Create test data
            const companyResponse = await request(app)
                .post("/items/companies")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Tech Corp",
                    technologies: ["javascript", "python", "golang"],
                    markets: ["fintech", "healthcare", "education"]
                });

            const departmentResponse = await request(app)
                .post("/items/departments")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Engineering",
                    focuses: ["web-development", "data-science", "devops"],
                    company_id: companyResponse.body.data.id
                });

            const employeeResponse = await request(app)
                .post("/items/employees")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    name: "Alice Developer",
                    skills: ["react", "nodejs", "postgresql"],
                    certifications: ["aws-certified", "kubernetes"],
                    department_id: departmentResponse.body.data.id
                });

            await request(app)
                .post("/items/projects")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    title: "E-commerce Platform",
                    tags: ["react", "microservices", "api"],
                    requirements: ["scalability", "security", "performance"],
                    employee_id: employeeResponse.body.data.id
                });

            // Test should pass if schemas were created successfully
            expect(companyResponse.status).toBe(201);
            expect(departmentResponse.status).toBe(201);
            expect(employeeResponse.status).toBe(201);
        });

        test("should filter projects by employee department company technologies (3-level deep)", async () => {
            // Test: Find projects where employee.department.company.technologies contains "javascript"
            const response = await request(app)
                .get("/items/projects")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "employee.department.company.technologies": { "arraycontains": "javascript" }
                    }),
                    fields: ["*", "employee.*", "employee.department.*", "employee.department.company.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);

            const project = response.body.data[0];
            expect(project.title).toBe("E-commerce Platform");
            expect(project.employee.department.company.technologies).toContain("javascript");
            expect(project.employee.department.company.name).toBe("Tech Corp");
        });

        test("should filter projects by employee department focuses (2-level deep)", async () => {
            // Test: Find projects where employee.department.focuses contains "web-development"
            const response = await request(app)
                .get("/items/projects")
                .set("Authorization", `Bearer ${adminToken}`)
                .query({
                    filter: JSON.stringify({
                        "employee.department.focuses": { "arraycontains": "web-development" }
                    }),
                    fields: ["*", "employee.*", "employee.department.*"]
                });

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            
            const project = response.body.data[0];
            expect(project.employee.department.focuses).toContain("web-development");
            expect(project.employee.department.name).toBe("Engineering");
        });
        
    });
});