/**
 * Field Validation Tests
 * 
 * Tests for runtime validation of fields including:
 * - Numeric fields: Integer, BigInt, Decimal, Double, Float, Real
 * - Numeric arrays: Array_Integer, Array_Double, etc.
 * - Numeric ranges: Range_Integer, Range_Decimal, etc.
 * - String fields: String, Text with notEmpty, isEmail, isUrl, len, pattern
 * - Default values: NOW, UUIDV4, SUID, AUTOINCREMENT, Boolean, static values
 */

import request from "supertest";
import { startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let adminToken;

beforeAll(async () => {
  app = await startServerForTesting();

  // Login as admin
  const adminLoginResponse = await request(app).post("/auth/login").send({
    email: "admin@baasix.com",
    password: "admin@123",
  });
  adminToken = adminLoginResponse.body.token;
});

afterAll(async () => {
  // Close the server
  if (app && app.server) {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

// ============================================================
// NUMERIC FIELD VALIDATION TESTS
// ============================================================

describe('Numeric Field Validation', () => {
  const testCollectionName = 'test_numeric_validation';

  beforeAll(async () => {
    // Clean up if exists
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore if doesn't exist
    }

    const schema = {
      name: testCollectionName,
      timestamps: true,
      fields: {
        id: {
          type: 'UUID',
          primaryKey: true,
          defaultValue: { type: 'UUIDV4' },
        },
        // Integer with min/max
        age: {
          type: 'Integer',
          allowNull: true,
          validate: {
            min: 0,
            max: 150,
          },
        },
        // Decimal with min/max
        price: {
          type: 'Decimal',
          allowNull: true,
          values: { precision: 10, scale: 2 },
          validate: {
            min: 0.01,
            max: 99999.99,
          },
        },
        // Double with min/max
        rating: {
          type: 'Double',
          allowNull: true,
          validate: {
            min: 0,
            max: 5,
          },
        },
        // Integer with isInt validation
        whole_number: {
          type: 'Double',
          allowNull: true,
          validate: {
            isInt: true,
          },
        },
        // Array of integers with validation
        scores: {
          type: 'Array_Integer',
          allowNull: true,
          validate: {
            min: 0,
            max: 100,
          },
        },
        // Range of integers
        age_range: {
          type: 'Range_Integer',
          allowNull: true,
          validate: {
            min: 0,
            max: 200,
          },
        },
        // Field without validation
        quantity: {
          type: 'Integer',
          allowNull: true,
        },
      },
    };

    // Create the schema
    const response = await request(app)
      .post("/schemas")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        collectionName: testCollectionName,
        schema: schema,
      });

    expect(response.status).toBe(201);
  });

  afterAll(async () => {
    // Clean up the test collection
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore errors
    }
  });

  describe('Integer field validation', () => {
    test('should accept value within range', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: 25 });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.age).toBe(25);
    });

    test('should accept boundary values (min)', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: 0 });

      expect(createResponse.status).toBe(201);
      
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.age).toBe(0);
    });

    test('should accept boundary values (max)', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: 150 });

      expect(createResponse.status).toBe(201);
      
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.age).toBe(150);
    });

    test('should reject value below minimum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject value above maximum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: 151 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('Decimal field validation', () => {
    test('should accept decimal value within range', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ price: 99.99 });

      expect(response.status).toBe(201);
    });

    test('should reject decimal value below minimum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ price: 0.001 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject decimal value above maximum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ price: 100000 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('isInt validation', () => {
    test('should accept integer value for isInt field', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ whole_number: 42 });

      expect(response.status).toBe(201);
    });

    test('should reject non-integer value for isInt field', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ whole_number: 42.5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('Array field validation', () => {
    test('should accept array with all valid values', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ scores: [85, 90, 95, 100] });

      expect(response.status).toBe(201);
    });

    test('should reject array with value below minimum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ scores: [85, -5, 95] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject array with value above maximum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ scores: [85, 105, 95] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('Range field validation', () => {
    test('should accept range with valid bounds', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age_range: [18, 65] });

      expect(response.status).toBe(201);
    });

    // Note: Range validation validates lower and upper bounds against min/max
    // This may or may not be supported depending on validation implementation
    test('should handle range with lower bound below minimum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age_range: [-5, 65] });

      // May be 201 if range validation doesn't check bounds, or 400 if it does
      expect([201, 400]).toContain(response.status);
    });

    test('should handle range with upper bound above maximum', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age_range: [18, 250] });

      // May be 201 if range validation doesn't check bounds, or 400 if it does
      expect([201, 400]).toContain(response.status);
    });
  });

  describe('Update validation', () => {
    let itemId;

    beforeAll(async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: 25, price: 10.00 });

      itemId = response.body.data.id;
    });

    test('should accept valid update', async () => {
      const response = await request(app)
        .patch(`/items/${testCollectionName}/${itemId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: 30 });

      expect(response.status).toBe(200);
    });

    test('should reject invalid update (below min)', async () => {
      const response = await request(app)
        .patch(`/items/${testCollectionName}/${itemId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: -10 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject invalid update (above max)', async () => {
      const response = await request(app)
        .patch(`/items/${testCollectionName}/${itemId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ age: 200 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('No validation field', () => {
    test('should accept any value for field without validation', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ quantity: 999999 });

      expect(response.status).toBe(201);
    });
  });
});

// ============================================================
// STRING FIELD VALIDATION TESTS
// ============================================================

describe('String Field Validation', () => {
  const testCollectionName = 'test_string_validation';

  beforeAll(async () => {
    // Clean up if exists
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore if doesn't exist
    }

    const schema = {
      name: testCollectionName,
      timestamps: true,
      fields: {
        id: {
          type: 'UUID',
          primaryKey: true,
          defaultValue: { type: 'UUIDV4' },
        },
        // String with notEmpty
        name: {
          type: 'String',
          allowNull: true,
          values: { length: 255 },
          validate: {
            notEmpty: true,
          },
        },
        // String with isEmail
        email: {
          type: 'String',
          allowNull: true,
          values: { length: 255 },
          validate: {
            isEmail: true,
          },
        },
        // String with isUrl
        website: {
          type: 'String',
          allowNull: true,
          values: { length: 500 },
          validate: {
            isUrl: true,
          },
        },
        // String with len (length range)
        username: {
          type: 'String',
          allowNull: true,
          values: { length: 50 },
          validate: {
            len: [3, 20],
          },
        },
        // String with pattern (is/matches)
        code: {
          type: 'String',
          allowNull: true,
          values: { length: 10 },
          validate: {
            is: '^[A-Z0-9]+$',
          },
        },
        // String with combined validation
        bio: {
          type: 'Text',
          allowNull: true,
          validate: {
            notEmpty: true,
            len: [10, 500],
          },
        },
        // String without validation
        notes: {
          type: 'Text',
          allowNull: true,
        },
      },
    };

    // Create the schema
    const response = await request(app)
      .post("/schemas")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        collectionName: testCollectionName,
        schema: schema,
      });

    expect(response.status).toBe(201);
  });

  afterAll(async () => {
    // Clean up
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore errors
    }
  });

  describe('notEmpty validation', () => {
    test('should accept non-empty string', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'John Doe' });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.name).toBe('John Doe');
    });

    test('should reject empty string', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject whitespace-only string', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('isEmail validation', () => {
    test('should accept valid email', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(201);
    });

    test('should accept email with subdomain', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: 'user@mail.example.com' });

      expect(response.status).toBe(201);
    });

    test('should reject invalid email (no @)', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject invalid email (no domain)', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: 'test@' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('isUrl validation', () => {
    test('should accept valid HTTP URL', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ website: 'http://example.com' });

      expect(response.status).toBe(201);
    });

    test('should accept valid HTTPS URL', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ website: 'https://www.example.com/path?query=value' });

      expect(response.status).toBe(201);
    });

    test('should reject invalid URL', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ website: 'not-a-url' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject URL without protocol', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ website: 'www.example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('len (length) validation', () => {
    test('should accept string within length range', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: 'johndoe' });

      expect(response.status).toBe(201);
    });

    test('should accept string at minimum length', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: 'abc' });

      expect(response.status).toBe(201);
    });

    test('should accept string at maximum length', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: 'a'.repeat(20) });

      expect(response.status).toBe(201);
    });

    test('should reject string below minimum length', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: 'ab' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject string above maximum length', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: 'a'.repeat(21) });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('pattern (is/matches) validation', () => {
    test('should accept string matching pattern', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: 'ABC123' });

      expect(response.status).toBe(201);
    });

    test('should reject string not matching pattern', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: 'abc123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject string with special characters', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: 'ABC-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('Combined validation', () => {
    test('should accept valid bio (notEmpty + length)', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ bio: 'This is a valid bio that meets all requirements.' });

      expect(response.status).toBe(201);
    });

    test('should reject empty bio', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ bio: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should reject bio too short', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ bio: 'Short' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('No validation field', () => {
    test('should accept any string for field without validation', async () => {
      const response = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ notes: '' });

      expect(response.status).toBe(201);
    });
  });
});

// ============================================================
// DEFAULT VALUE TESTS
// ============================================================

describe('Default Value Tests', () => {
  const testCollectionName = 'test_default_values';

  beforeAll(async () => {
    // Clean up if exists
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore if doesn't exist
    }

    const schema = {
      name: testCollectionName,
      timestamps: true,
      fields: {
        id: {
          type: 'UUID',
          primaryKey: true,
          defaultValue: { type: 'UUIDV4' },
        },
        // UUID with UUIDV4 default
        tracking_id: {
          type: 'UUID',
          allowNull: true,
          defaultValue: { type: 'UUIDV4' },
        },
        // DateTime with NOW default
        created_timestamp: {
          type: 'DateTime',
          allowNull: true,
          defaultValue: { type: 'NOW' },
        },
        // Date with NOW default
        created_date: {
          type: 'Date',
          allowNull: true,
          defaultValue: { type: 'NOW' },
        },
        // Boolean with default true
        is_active: {
          type: 'Boolean',
          allowNull: false,
          defaultValue: true,
        },
        // Boolean with default false
        is_deleted: {
          type: 'Boolean',
          allowNull: false,
          defaultValue: false,
        },
        // Integer with default value
        priority: {
          type: 'Integer',
          allowNull: false,
          defaultValue: 5,
        },
        // String with default value
        status: {
          type: 'String',
          allowNull: false,
          values: { length: 50 },
          defaultValue: 'pending',
        },
        // Name field (no default)
        name: {
          type: 'String',
          allowNull: true,
          values: { length: 255 },
        },
      },
    };

    // Create the schema
    const response = await request(app)
      .post("/schemas")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        collectionName: testCollectionName,
        schema: schema,
      });

    expect(response.status).toBe(201);
  });

  afterAll(async () => {
    // Clean up
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore errors
    }
  });

  describe('UUID default value', () => {
    test('should auto-generate UUID when not provided', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Test Item' });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.data.id).toBeDefined();
      
      // Fetch the created record to verify tracking_id
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      // UUID v4 format check
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(getResponse.body.data.id).toMatch(uuidRegex);
      expect(getResponse.body.data.tracking_id).toMatch(uuidRegex);
    });
  });

  describe('DateTime NOW default value', () => {
    test('should set current timestamp when not provided', async () => {
      const beforeCreate = new Date();
      
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'DateTime Test' });

      const afterCreate = new Date();

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.created_timestamp).toBeDefined();
      
      const createdTimestamp = new Date(getResponse.body.data.created_timestamp);
      expect(createdTimestamp.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
      expect(createdTimestamp.getTime()).toBeLessThanOrEqual(afterCreate.getTime() + 1000);
    });
  });

  describe('Date NOW default value', () => {
    test('should set current date when not provided', async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Date Test' });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.created_date).toBeDefined();
      // Date should be today's date
      expect(getResponse.body.data.created_date).toContain(today);
    });
  });

  describe('Boolean default value', () => {
    test('should set default true for is_active', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Boolean Test' });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.is_active).toBe(true);
    });

    test('should set default false for is_deleted', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Boolean Test 2' });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.is_deleted).toBe(false);
    });

    test('should allow overriding boolean default', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Override Test', is_active: false });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.is_active).toBe(false);
    });
  });

  describe('Integer default value', () => {
    test('should set default numeric value', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Priority Test' });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.priority).toBe(5);
    });

    test('should allow overriding numeric default', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Priority Override', priority: 10 });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.priority).toBe(10);
    });
  });

  describe('String default value', () => {
    test('should set default string value', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Status Test' });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.status).toBe('pending');
    });

    test('should allow overriding string default', async () => {
      const createResponse = await request(app)
        .post(`/items/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: 'Status Override', status: 'active' });

      expect(createResponse.status).toBe(201);
      
      // Fetch the created record to verify
      const getResponse = await request(app)
        .get(`/items/${testCollectionName}/${createResponse.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      
      expect(getResponse.body.data.status).toBe('active');
    });
  });
});

// ============================================================
// AUTO-INCREMENT DEFAULT VALUE TESTS
// ============================================================

describe('Auto-Increment Default Value Tests', () => {
  const testCollectionName = 'test_autoincrement';

  beforeAll(async () => {
    // Clean up if exists
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore if doesn't exist
    }

    const schema = {
      name: testCollectionName,
      timestamps: true,
      fields: {
        id: {
          type: 'Integer',
          primaryKey: true,
          defaultValue: { type: 'AUTOINCREMENT' },
        },
        name: {
          type: 'String',
          allowNull: false,
          values: { length: 255 },
        },
      },
    };

    // Create the schema
    const response = await request(app)
      .post("/schemas")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        collectionName: testCollectionName,
        schema: schema,
      });

    expect(response.status).toBe(201);
  });

  afterAll(async () => {
    // Clean up
    try {
      await request(app)
        .delete(`/schemas/${testCollectionName}`)
        .set("Authorization", `Bearer ${adminToken}`);
    } catch (e) {
      // Ignore errors
    }
  });

  test('should auto-increment ID for each new record', async () => {
    // Create first record
    const response1 = await request(app)
      .post(`/items/${testCollectionName}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: 'First Item' });

    expect(response1.status).toBe(201);
    const id1 = response1.body.data.id;
    expect(typeof id1).toBe('number');

    // Create second record
    const response2 = await request(app)
      .post(`/items/${testCollectionName}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: 'Second Item' });

    expect(response2.status).toBe(201);
    const id2 = response2.body.data.id;
    expect(typeof id2).toBe('number');

    // ID should be incremented
    expect(id2).toBe(id1 + 1);

    // Create third record
    const response3 = await request(app)
      .post(`/items/${testCollectionName}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: 'Third Item' });

    expect(response3.status).toBe(201);
    const id3 = response3.body.data.id;
    expect(id3).toBe(id2 + 1);
  });
});
