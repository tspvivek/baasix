// File: test/userInfoEndpoint.test.js

import request from 'supertest';
import { destroyAllTablesInDB, startServerForTesting } from '../baasix';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
let app;

describe('User Info Custom Endpoint', () => {
  let adminToken;

  beforeAll(async () => {
    await destroyAllTablesInDB();

    app = await startServerForTesting();

    // Login as admin
    const adminLoginResponse = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@baasix.com', password: 'admin@123' });
    adminToken = adminLoginResponse.body.token;
  });

  test('GET /user-info returns correct user and role details for admin', async () => {
    const response = await request(app)
      .get('/user-info')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user: {
        id: expect.any(String),
        email: 'admin@baasix.com',
        firstName: expect.any(String),
      },
      role: {
        id: expect.any(String),
        name: 'administrator',
      },
    });

    // Check for specific fields to ensure we're getting the right data
    expect(response.body.user).toHaveProperty('id');
    expect(response.body.user).toHaveProperty('email');
    expect(response.body.user).toHaveProperty('firstName');
    expect(response.body.role).toHaveProperty('id');
    expect(response.body.role).toHaveProperty('name');

    // Ensure we're not exposing sensitive information
    expect(response.body.user).not.toHaveProperty('password');
  });

  test('GET /user-info returns 401 for unauthenticated request', async () => {
    const response = await request(app).get('/user-info');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error.message).toBe('Unauthorized');
  });
});

afterAll(async () => {
  // Close the server
  if (app.server) {
      await new Promise((resolve) => app.server.close(resolve));
  }
});
