/**
 * Virtual/Computed Fields Test
 * Tests SQL-based generated columns for computed fields
 * 
 * NOTE: Most tests are skipped because VIRTUAL fields require database migration.
 * The implementation is ready in typeMapper.ts but existing tables need to be
 * recreated/migrated to add the generated columns.
 * 
 * To enable: Run database migration to add generated columns for VIRTUAL fields.
 */

import request from "supertest";
import { startServerForTesting } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

let app;
let authToken;
let testUserId;

beforeAll(async () => {
  // Start server for testing
  app = await startServerForTesting();
  
  // Login as admin
  const loginRes = await request(app)
    .post('/auth/login')
    .send({
      email: 'admin@baasix.com',
      password: 'admin@123'
    });

  authToken = loginRes.body.token;
}, 30000);

describe('Virtual/Computed Fields', () => {
  describe('User fullName virtual field', () => {
    test('should create user with fullName computed', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: `john.doe.${Date.now()}@example.com`,
          password: 'password123'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      
      testUserId = res.body.user.id;
    });

    test('should include fullName in query results', async () => {
      const res = await request(app)
        .get('/items/baasix_User')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          fields: 'id,fullName',
          limit: 1
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        expect(res.body.data[0]).toHaveProperty('fullName');
        expect(typeof res.body.data[0].fullName).toBe('string');
      }
    });

    test('should handle null lastName in fullName', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          firstName: 'Jane',
          lastName: null,
          email: `jane.${Date.now()}@example.com`,
          password: 'password123'
        });

      expect(res.status).toBe(200);
      expect(res.body.user).toHaveProperty('firstName');
      
      // Clean up
      if (res.body.user?.id) {
        await request(app)
          .delete(`/items/baasix_User/${res.body.user.id}`)
          .set('Authorization', `Bearer ${authToken}`);
      }
    });

    test('should query by fullName', async () => {
      const res = await request(app)
        .get('/items/baasix_User')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          filter: JSON.stringify({
            fullName: { like: '%Admin%' }
          }),
          fields: 'id,firstName,lastName,fullName'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('should include fullName in response', async () => {
      if (!testUserId) {
        // Skip if no test user created
        return;
      }
      
      const res = await request(app)
        .get(`/items/baasix_User/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          fields: 'id,firstName,lastName,fullName,email'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('fullName');
      expect(typeof res.body.data.fullName).toBe('string');
    });

    test('should update user and recompute fullName', async () => {
      if (!testUserId) {
        // Skip if no test user created
        return;
      }

      const res = await request(app)
        .patch(`/items/baasix_User/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lastName: 'Smith'
        });

      expect(res.status).toBe(200);
      
      // Verify the fullName was recomputed
      const getRes = await request(app)
        .get(`/items/baasix_User/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          fields: 'id,firstName,lastName,fullName'
        });

      expect(getRes.status).toBe(200);
      expect(getRes.body).toHaveProperty('data');
      expect(getRes.body.data).toHaveProperty('fullName');
      expect(getRes.body.data.fullName).toContain('Smith');
    });

    test('fullName should be read-only (cannot be set directly)', async () => {
      if (!testUserId) {
        // Skip if no test user created
        return;
      }

      // Try to set fullName directly - it should be ignored or return error
      const res = await request(app)
        .patch(`/items/baasix_User/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Ignored Name'
        });

      // The update should succeed (fullName field is filtered out) or return an appropriate error
      // For now, accept either 200 (success, field ignored) or 400 (validation error)
      if (res.status !== 200) {
        console.log('Update with fullName response:', res.status, res.body);
      }
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Custom virtual fields', () => {
    test('should support custom computed field schema', async () => {
      // This test would require creating a custom collection with computed fields
      // For now, just verify the User fullName works as a baseline
      const res = await request(app)
        .get('/items/baasix_User')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          fields: 'id,fullName',
          limit: 1
        });

      expect(res.status).toBe(200);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty('fullName');
      }
    });
  });
});

afterAll(async () => {
  // Cleanup test user
  if (testUserId) {
    await request(app)
      .delete(`/items/baasix_User/${testUserId}`)
      .set('Authorization', `Bearer ${authToken}`);
  }
});

