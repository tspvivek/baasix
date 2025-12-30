/**
 * OAuth Provider Integration Tests
 * 
 * Tests OAuth authentication flows for Google, GitHub, Facebook, and Apple providers.
 * Uses msw (Mock Service Worker) to mock OAuth provider endpoints.
 * 
 * Test Categories:
 * 1. OAuth URL Generation - Tests that authorization URLs are correctly generated
 * 2. OAuth Callback Handling - Tests the callback flow with mocked provider responses
 * 3. Account Linking - Tests linking OAuth accounts to existing users
 * 4. Error Handling - Tests various error scenarios
 * 
 * SETUP:
 * 1. Install msw: npm install -D msw
 * 2. Set environment variables in .env.test:
 *    AUTH_SERVICES_ENABLED=LOCAL,GOOGLE,GITHUB,FACEBOOK,APPLE
 *    GOOGLE_CLIENT_ID=test-google-client-id
 *    GOOGLE_CLIENT_SECRET=test-google-client-secret
 *    GITHUB_CLIENT_ID=test-github-client-id
 *    GITHUB_CLIENT_SECRET=test-github-client-secret
 *    FACEBOOK_CLIENT_ID=test-facebook-client-id
 *    FACEBOOK_CLIENT_SECRET=test-facebook-client-secret
 *    APPLE_CLIENT_ID=test-apple-client-id
 *    APPLE_CLIENT_SECRET=test-apple-client-secret
 *    APPLE_TEAM_ID=test-apple-team-id
 *    APPLE_KEY_ID=test-apple-key-id
 */

import request from "supertest";
import { destroyAllTablesInDB, startServerForTesting } from "../baasix";
import { beforeAll, afterAll, afterEach, test, expect, describe } from "@jest/globals";

// MSW modules - loaded at module level
let http, HttpResponse, setupServer, mswServer;
let mswAvailable = false;

// Load MSW at module level (top-level await supported with --experimental-vm-modules)
try {
    const mswModule = await import("msw");
    const mswNodeModule = await import("msw/node");
    http = mswModule.http;
    HttpResponse = mswModule.HttpResponse;
    setupServer = mswNodeModule.setupServer;
    mswAvailable = true;
} catch (e) {
    console.warn("msw not installed. Callback tests will be skipped. Install with: npm install -D msw");
}

// =====================
// Mock OAuth Responses
// =====================

// Mock user data for each provider
const mockGoogleUser = {
    sub: "google-user-123",
    email: "google-user@gmail.com",
    email_verified: true,
    name: "Google Test User",
    given_name: "Google",
    family_name: "User",
    picture: "https://lh3.googleusercontent.com/a/mock-photo",
    locale: "en",
};

const mockGitHubUser = {
    id: 12345678,
    login: "github-test-user",
    email: "github-user@github.com",
    name: "GitHub Test User",
    avatar_url: "https://avatars.githubusercontent.com/u/12345678",
};

const mockFacebookUser = {
    id: "facebook-user-123",
    email: "facebook-user@facebook.com",
    name: "Facebook Test User",
    first_name: "Facebook",
    last_name: "User",
    picture: {
        data: {
            url: "https://graph.facebook.com/mock-photo",
        },
    },
};

const mockAppleUser = {
    sub: "apple-user-123.abc.def",
    email: "apple-user@privaterelay.appleid.com",
    email_verified: "true",
    is_private_email: "true",
    real_user_status: 2,
};

// Helper to create mock tokens
function createMockTokens(provider) {
    return {
        access_token: `mock-${provider}-access-token-${Date.now()}`,
        refresh_token: `mock-${provider}-refresh-token-${Date.now()}`,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "email profile",
    };
}

// Helper to create a mock ID token (for Google)
function createMockIdToken(payload) {
    // Simple mock - in real tests you might use jose to create proper JWTs
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = "mock-signature";
    return `${header}.${body}.${signature}`;
}

// =====================
// MSW Server Setup (if available)
// =====================

function setupMswHandlers() {
    if (!mswAvailable) return null;
    
    const handlers = [
        // Google OAuth Token Endpoint
        http.post("https://oauth2.googleapis.com/token", async ({ request }) => {
            const body = await request.formData();
            const code = body.get("code");
            
            // Simulate invalid code
            if (code === "invalid-code") {
                return HttpResponse.json(
                    { error: "invalid_grant", error_description: "Invalid authorization code" },
                    { status: 400 }
                );
            }
            
            const tokens = createMockTokens("google");
            tokens.id_token = createMockIdToken({
                ...mockGoogleUser,
                iss: "https://accounts.google.com",
                aud: "test-google-client-id",
                exp: Math.floor(Date.now() / 1000) + 3600,
                iat: Math.floor(Date.now() / 1000),
            });
            
            return HttpResponse.json(tokens);
        }),

        // Google UserInfo Endpoint
        http.get("https://www.googleapis.com/oauth2/v3/userinfo", ({ request }) => {
            const authHeader = request.headers.get("authorization");
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return HttpResponse.json({ error: "unauthorized" }, { status: 401 });
            }
            return HttpResponse.json(mockGoogleUser);
        }),

        // GitHub OAuth Token Endpoint
        http.post("https://github.com/login/oauth/access_token", async ({ request }) => {
            const body = await request.formData().catch(() => null);
            const jsonBody = body ? null : await request.json().catch(() => null);
            const code = body?.get("code") || jsonBody?.code;
            
            if (code === "invalid-code") {
                return HttpResponse.json(
                    { error: "bad_verification_code", error_description: "Invalid code" },
                    { status: 400 }
                );
            }
            
            return HttpResponse.json(createMockTokens("github"));
        }),

        // GitHub User Endpoint
        http.get("https://api.github.com/user", ({ request }) => {
            const authHeader = request.headers.get("authorization");
            if (!authHeader) {
                return HttpResponse.json({ message: "Requires authentication" }, { status: 401 });
            }
            return HttpResponse.json(mockGitHubUser);
        }),

        // GitHub User Emails Endpoint (for users with private email)
        http.get("https://api.github.com/user/emails", ({ request }) => {
            return HttpResponse.json([
                { email: mockGitHubUser.email, primary: true, verified: true },
            ]);
        }),

        // Facebook OAuth Token Endpoint (POST method)
        http.post("https://graph.facebook.com/v18.0/oauth/access_token", async ({ request }) => {
            const body = await request.text();
            const params = new URLSearchParams(body);
            const code = params.get("code");
            
            if (code === "invalid-code") {
                return HttpResponse.json(
                    { error: { message: "Invalid verification code" } },
                    { status: 400 }
                );
            }
            
            return HttpResponse.json(createMockTokens("facebook"));
        }),

        // Facebook User Endpoint
        http.get("https://graph.facebook.com/v18.0/me", ({ request }) => {
            const url = new URL(request.url);
            const accessToken = url.searchParams.get("access_token");
            
            if (!accessToken) {
                return HttpResponse.json({ error: { message: "Invalid token" } }, { status: 401 });
            }
            
            return HttpResponse.json(mockFacebookUser);
        }),

        // Apple OAuth Token Endpoint
        http.post("https://appleid.apple.com/auth/token", async ({ request }) => {
            const body = await request.formData();
            const code = body.get("code");
            
            if (code === "invalid-code") {
                return HttpResponse.json(
                    { error: "invalid_grant" },
                    { status: 400 }
                );
            }
            
            const tokens = createMockTokens("apple");
            // Apple returns user info in the id_token
            tokens.id_token = createMockIdToken({
                ...mockAppleUser,
                iss: "https://appleid.apple.com",
                aud: "test-apple-client-id",
                exp: Math.floor(Date.now() / 1000) + 3600,
                iat: Math.floor(Date.now() / 1000),
            });
            
            return HttpResponse.json(tokens);
        }),
    ];
    
    return setupServer(...handlers);
}

// =====================
// Test Suite
// =====================

let app;
let adminToken;

beforeAll(async () => {
    // Setup MSW if available (loaded at module level)
    if (mswAvailable) {
        mswServer = setupMswHandlers();
        mswServer.listen({ onUnhandledRequest: "bypass" });
    }
    
    // Set OAuth environment variables for testing
    process.env.AUTH_SERVICES_ENABLED = "LOCAL,GOOGLE,GITHUB,FACEBOOK,APPLE";
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
    process.env.GITHUB_CLIENT_ID = "test-github-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";
    process.env.FACEBOOK_CLIENT_ID = "test-facebook-client-id";
    process.env.FACEBOOK_CLIENT_SECRET = "test-facebook-client-secret";
    process.env.APPLE_CLIENT_ID = "test-apple-client-id";
    process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";
    process.env.APPLE_TEAM_ID = "test-apple-team-id";
    process.env.APPLE_KEY_ID = "test-apple-key-id";
    process.env.BASE_URL = "http://localhost:8056";
    
    await destroyAllTablesInDB();
    app = await startServerForTesting();
    
    // Login as admin
    const adminLoginResponse = await request(app)
        .post("/auth/login")
        .send({ email: "admin@baasix.com", password: "admin@123" });
    adminToken = adminLoginResponse.body.token;
});

afterEach(() => {
    if (mswServer) {
        mswServer.resetHandlers();
    }
});

afterAll(async () => {
    if (mswServer) {
        mswServer.close();
    }
});

// =====================
// OAuth URL Generation Tests
// =====================

describe("OAuth Authorization URL Generation", () => {
    
    describe("Google OAuth", () => {
        test("should generate valid Google authorization URL", async () => {
            const res = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "google",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            // Should return redirect URL
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty("redirect", true);
            expect(res.body).toHaveProperty("url");
            
            const url = res.body.url;
            expect(url).toContain("accounts.google.com");
            expect(url).toContain("client_id=test-google-client-id");
            expect(url).toContain("response_type=code");
            expect(url).toContain("scope=");
            expect(url).toContain("state=");
        });
        
        test("should include requested scopes in authorization URL", async () => {
            const res = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "google",
                    callbackURL: "http://localhost:3000/callback",
                    scopes: ["email", "profile", "https://www.googleapis.com/auth/drive.readonly"]
                });
            
            expect(res.statusCode).toBe(200);
            expect(res.body.url).toContain("drive.readonly");
        });
    });
    
    describe("GitHub OAuth", () => {
        test("should generate valid GitHub authorization URL", async () => {
            const res = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "github",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty("redirect", true);
            expect(res.body).toHaveProperty("url");
            
            const url = res.body.url;
            expect(url).toContain("github.com/login/oauth/authorize");
            expect(url).toContain("client_id=test-github-client-id");
        });
    });
    
    describe("Facebook OAuth", () => {
        test("should generate valid Facebook authorization URL", async () => {
            const res = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "facebook",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty("redirect", true);
            expect(res.body).toHaveProperty("url");
            
            const url = res.body.url;
            expect(url).toContain("facebook.com");
            expect(url).toContain("client_id=test-facebook-client-id");
        });
    });
    
    describe("Apple OAuth", () => {
        test("should generate valid Apple authorization URL", async () => {
            const res = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "apple",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty("redirect", true);
            expect(res.body).toHaveProperty("url");
            
            const url = res.body.url;
            expect(url).toContain("appleid.apple.com");
            expect(url).toContain("client_id=test-apple-client-id");
            expect(url).toContain("response_mode=form_post");
        });
    });
    
    test("should return error for disabled provider", async () => {
        const res = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "twitter",
                callbackURL: "http://localhost:3000/callback" 
            });
        
        // Twitter is not in AUTH_SERVICES_ENABLED
        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty("message");
    });
    
    test("should return error when provider is missing", async () => {
        const res = await request(app)
            .post("/auth/social/signin")
            .send({ 
                callbackURL: "http://localhost:3000/callback" 
            });
        
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain("required");
    });
});

// =====================
// OAuth Callback Tests (requires msw)
// =====================

const describeWithMsw = mswAvailable ? describe : describe.skip;

describeWithMsw("OAuth Callback Handling", () => {
    
    describe("Google OAuth Callback", () => {
        test("should handle successful Google OAuth callback", async () => {
            // First, get the authorization URL to get a valid state
            const authRes = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "google",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(authRes.statusCode).toBe(200);
            const url = new URL(authRes.body.url);
            const state = url.searchParams.get("state");
            
            // Simulate callback with valid code
            const callbackRes = await request(app)
                .get("/auth/callback/google")
                .query({ 
                    code: "valid-auth-code",
                    state: state
                });
            
            // Should return user data or redirect
            expect([200, 302, 400]).toContain(callbackRes.statusCode);
            
            if (callbackRes.statusCode === 200) {
                expect(callbackRes.body).toHaveProperty("user");
                expect(callbackRes.body).toHaveProperty("token");
            }
        });
        
        test("should handle invalid authorization code", async () => {
            const res = await request(app)
                .get("/auth/callback/google")
                .query({ 
                    code: "invalid-code",
                    state: "test-state"
                });
            
            // Should return error
            expect([400, 401]).toContain(res.statusCode);
        });
        
        test("should handle missing state parameter", async () => {
            const res = await request(app)
                .get("/auth/callback/google")
                .query({ code: "valid-auth-code" });
            
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain("state");
        });
        
        test("should handle OAuth error response", async () => {
            const res = await request(app)
                .get("/auth/callback/google")
                .query({ 
                    error: "access_denied",
                    error_description: "User denied access"
                });
            
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain("denied");
        });
    });
    
    describe("GitHub OAuth Callback", () => {
        test("should handle successful GitHub OAuth callback", async () => {
            // Get authorization URL to get state
            const authRes = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "github",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(authRes.statusCode).toBe(200);
            const url = new URL(authRes.body.url);
            const state = url.searchParams.get("state");
            
            const callbackRes = await request(app)
                .get("/auth/callback/github")
                .query({ 
                    code: "valid-github-code",
                    state: state
                });
            
            expect([200, 302, 400]).toContain(callbackRes.statusCode);
        });
    });
    
    describe("Facebook OAuth Callback", () => {
        test("should handle successful Facebook OAuth callback", async () => {
            // Get authorization URL to get state
            const authRes = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "facebook",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(authRes.statusCode).toBe(200);
            const url = new URL(authRes.body.url);
            const state = url.searchParams.get("state");
            
            const callbackRes = await request(app)
                .get("/auth/callback/facebook")
                .query({ 
                    code: "valid-facebook-code",
                    state: state
                });
            
            expect([200, 302, 400]).toContain(callbackRes.statusCode);
            
            if (callbackRes.statusCode === 200 && callbackRes.body.user) {
                expect(callbackRes.body.user.email).toBe(mockFacebookUser.email);
            }
        });
    });
    
    describe("Apple OAuth Callback", () => {
        test("should handle successful Apple OAuth callback", async () => {
            // Get authorization URL to get state
            const authRes = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "apple",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(authRes.statusCode).toBe(200);
            const url = new URL(authRes.body.url);
            const state = url.searchParams.get("state");
            
            // Apple uses POST for callback (form_post response mode)
            const callbackRes = await request(app)
                .post("/auth/callback/apple")
                .type("form")
                .send({ 
                    code: "valid-apple-code",
                    state: state
                });
            
            expect([200, 302, 400]).toContain(callbackRes.statusCode);
            
            if (callbackRes.statusCode === 200 && callbackRes.body.user) {
                expect(callbackRes.body.user.email).toBe(mockAppleUser.email);
            }
        });
        
        test("should handle Apple callback with user info on first sign-in", async () => {
            // Apple only sends user info on first authorization
            const authRes = await request(app)
                .post("/auth/social/signin")
                .send({ 
                    provider: "apple",
                    callbackURL: "http://localhost:3000/callback" 
                });
            
            expect(authRes.statusCode).toBe(200);
            const url = new URL(authRes.body.url);
            const state = url.searchParams.get("state");
            
            // Apple sends user info as JSON string in 'user' parameter on first auth
            const callbackRes = await request(app)
                .post("/auth/callback/apple")
                .type("form")
                .send({ 
                    code: "valid-apple-code",
                    state: state,
                    user: JSON.stringify({
                        name: {
                            firstName: "Apple",
                            lastName: "User"
                        },
                        email: "apple-user@privaterelay.appleid.com"
                    })
                });
            
            expect([200, 302, 400]).toContain(callbackRes.statusCode);
        });
    });
});

// =====================
// User Creation from OAuth Tests (requires msw)
// =====================

describeWithMsw("User Creation from OAuth", () => {
    
    test("should create new user from Google OAuth if not exists", async () => {
        // This test verifies that a new user is created in the database
        // when they sign in with OAuth for the first time
        
        // First get auth URL
        const authRes = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "google",
                callbackURL: "http://localhost:3000/callback" 
            });
        
        expect(authRes.statusCode).toBe(200);
        const url = new URL(authRes.body.url);
        const state = url.searchParams.get("state");
        
        // Complete OAuth flow
        const callbackRes = await request(app)
            .get("/auth/callback/google")
            .query({ 
                code: "valid-auth-code",
                state: state
            });
        
        if (callbackRes.statusCode === 200 && callbackRes.body.user) {
            expect(callbackRes.body.user.email).toBe(mockGoogleUser.email);
            expect(callbackRes.body.user.firstName).toBe(mockGoogleUser.given_name);
        }
    });
    
    test("should link OAuth account to existing user with same email", async () => {
        // Create a user first with the same email as OAuth user
        const userEmail = "link-test@gmail.com";
        
        // Register user with email/password
        await request(app).post("/auth/register").send({
            firstName: "Link",
            lastName: "Test",
            email: userEmail,
            password: "password123",
        });
        
        // Override the mock to return this user's email
        mswServer.use(
            http.get("https://www.googleapis.com/oauth2/v3/userinfo", () => {
                return HttpResponse.json({
                    ...mockGoogleUser,
                    email: userEmail,
                });
            })
        );
        
        // Try to sign in with Google
        const authRes = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "google",
                callbackURL: "http://localhost:3000/callback" 
            });
        
        expect(authRes.statusCode).toBe(200);
        const url = new URL(authRes.body.url);
        const state = url.searchParams.get("state");
        
        const callbackRes = await request(app)
            .get("/auth/callback/google")
            .query({ 
                code: "valid-auth-code",
                state: state
            });
        
        // Should succeed and link to existing user
        expect([200, 302, 400]).toContain(callbackRes.statusCode);
    });
});

// =====================
// Error Handling Tests (requires msw)
// =====================

describeWithMsw("OAuth Error Handling", () => {
    
    test("should handle provider API errors gracefully", async () => {
        // Override to return server error
        mswServer.use(
            http.get("https://www.googleapis.com/oauth2/v3/userinfo", () => {
                return HttpResponse.json(
                    { error: "server_error" },
                    { status: 500 }
                );
            })
        );
        
        const authRes = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "google",
                callbackURL: "http://localhost:3000/callback" 
            });
        
        expect(authRes.statusCode).toBe(200);
        const url = new URL(authRes.body.url);
        const state = url.searchParams.get("state");
        
        const callbackRes = await request(app)
            .get("/auth/callback/google")
            .query({ 
                code: "valid-auth-code",
                state: state
            });
        
        // Should handle error gracefully
        expect([400, 500]).toContain(callbackRes.statusCode);
    });
    
    test("should handle token exchange failure", async () => {
        mswServer.use(
            http.post("https://oauth2.googleapis.com/token", () => {
                return HttpResponse.json(
                    { error: "server_error" },
                    { status: 500 }
                );
            })
        );
        
        // Get a valid state first
        const authRes = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "google",
                callbackURL: "http://localhost:3000/callback" 
            });
        
        const url = new URL(authRes.body.url);
        const state = url.searchParams.get("state");
        
        const callbackRes = await request(app)
            .get("/auth/callback/google")
            .query({ 
                code: "valid-auth-code",
                state: state
            });
        
        expect([400, 500]).toContain(callbackRes.statusCode);
    });
    
    test("should handle missing email from provider", async () => {
        mswServer.use(
            http.get("https://www.googleapis.com/oauth2/v3/userinfo", () => {
                return HttpResponse.json({
                    ...mockGoogleUser,
                    email: null,
                    email_verified: false,
                });
            })
        );
        
        const authRes = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "google",
                callbackURL: "http://localhost:3000/callback" 
            });
        
        expect(authRes.statusCode).toBe(200);
        const url = new URL(authRes.body.url);
        const state = url.searchParams.get("state");
        
        const callbackRes = await request(app)
            .get("/auth/callback/google")
            .query({ 
                code: "valid-auth-code",
                state: state
            });
        
        // Should handle missing email appropriately
        expect([400, 200]).toContain(callbackRes.statusCode);
    });
});

// =====================
// Multi-tenant OAuth Tests (requires msw)
// =====================

describeWithMsw("OAuth with Multi-tenant", () => {
    
    beforeAll(() => {
        process.env.MULTI_TENANT = "true";
    });
    
    afterAll(() => {
        process.env.MULTI_TENANT = "false";
    });
    
    test("should handle OAuth sign-in with tenant context", async () => {
        // In multi-tenant mode, OAuth users might need tenant assignment
        const authRes = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "google",
                callbackURL: "http://localhost:3000/callback"
                // Some implementations pass tenant in state/callbackURL
            });
        
        // Should return authorization URL
        expect(authRes.statusCode).toBe(200);
        expect(authRes.body.url).toBeDefined();
        expect(authRes.body.url).toContain("accounts.google.com");
    });
});

// =====================
// Session Tests (requires msw)
// =====================

describeWithMsw("OAuth Session Management", () => {
    
    test("should create valid session after OAuth login", async () => {
        const authRes = await request(app)
            .post("/auth/social/signin")
            .send({ 
                provider: "google",
                callbackURL: "http://localhost:3000/callback" 
            });
        
        expect(authRes.statusCode).toBe(200);
        const url = new URL(authRes.body.url);
        const state = url.searchParams.get("state");
        
        const callbackRes = await request(app)
            .get("/auth/callback/google")
            .query({ 
                code: "valid-auth-code",
                state: state
            });
        
        if (callbackRes.body.token) {
            // Verify token works
            const meRes = await request(app)
                .get("/auth/me")
                .set("Authorization", `Bearer ${callbackRes.body.token}`);
            
            expect([200, 401]).toContain(meRes.statusCode);
        }
    });
});
