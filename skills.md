# BAASIX.md - AI Coding Assistant Guide

> Comprehensive guide for AI assistants helping developers build with Baasix.
> Use this file alongside llms.txt for complete context.

## Overview

Baasix is an open-source Backend-as-a-Service (BaaS) that generates REST APIs from data models. Key differentiators:

- **Dynamic Schemas**: Create/modify tables via API at runtime
- **PostgreSQL + PostGIS**: Full SQL power with geospatial support
- **Drizzle ORM**: Modern TypeScript ORM under the hood
- **50+ Filter Operators**: Most comprehensive query system
- **Visual Workflows**: 17 node types for automation
- **Enterprise Ready**: Multi-tenancy, caching, real-time

---

## Quick Start Template

```javascript
// 1. Install
npm install @tspvivek/baasix

// 2. Create server.js
import { startServer } from "@tspvivek/baasix";
startServer().catch(console.error);

// 3. Add to package.json: "type": "module"

// 4. Create .env
DATABASE_URL="postgresql://postgres:password@localhost:5432/baasix"
SECRET_KEY=your-32-character-secret-key-here

// 5. Run
node server.js
```

---

## Task: Create a New Collection/Table

### Step 1: Design the Schema

```javascript
// POST /schemas
{
  "collectionName": "products",  // Table name (lowercase, snake_case)
  "schema": {
    "name": "Product",           // Model name (PascalCase)
    "timestamps": true,          // Adds createdAt, updatedAt
    "paranoid": false,           // Set true for soft deletes (adds deletedAt)
    "fields": {
      "id": {
        "type": "UUID",
        "primaryKey": true,
        "defaultValue": {"type": "UUIDV4"}
      },
      "name": {
        "type": "String",
        "allowNull": false,
        "values": {"length": 255}  // VARCHAR(255)
      },
      "description": {
        "type": "Text",           // Unlimited length
        "allowNull": true
      },
      "price": {
        "type": "Decimal",
        "values": {"precision": 10, "scale": 2},
        "allowNull": false,
        "defaultValue": 0.00
      },
      "sku": {
        "type": "String",
        "allowNull": false,
        "unique": true
      },
      "inStock": {
        "type": "Boolean",
        "allowNull": false,
        "defaultValue": true
      },
      "quantity": {
        "type": "Integer",
        "allowNull": false,
        "defaultValue": 0,
        "validate": {"min": 0}
      },
      "tags": {
        "type": "Array",
        "values": {"type": "String"},
        "defaultValue": []
      },
      "metadata": {
        "type": "JSONB",
        "allowNull": true,
        "defaultValue": {}
      }
    }
  }
}
```

### Step 2: Add Relationships

```javascript
// POST /schemas/products/relationships
// BelongsTo Category
{
  "type": "M2O",
  "target": "categories",
  "name": "category",      // products.category_Id → categories.id
  "alias": "products"      // categories.products (reverse)
}

// POST /schemas/products/relationships
// Many-to-Many with Tags
{
  "type": "M2M",
  "target": "tags",
  "name": "tags",
  "alias": "products"
}
```

### Step 3: Add Indexes

```javascript
// POST /schemas/products/indexes
{
  "name": "idx_products_sku",
  "fields": ["sku"],
  "unique": true
}

// Composite index for common queries
{
  "name": "idx_products_category_instock",
  "fields": ["category_Id", "inStock"]
}
```

---

## Task: Build Complex Queries

### Basic CRUD

```javascript
// Create
POST /items/products
{ "name": "Widget", "price": 29.99, "sku": "WDG-001" }

// Read one
GET /items/products/{id}

// Update
PATCH /items/products/{id}
{ "price": 24.99 }

// Delete
DELETE /items/products/{id}

// Bulk operations
POST /items/products/bulk
[{ "name": "A", "sku": "A" }, { "name": "B", "sku": "B" }]
```

### Query with Filters

```javascript
// Active products under $50 in electronics category
GET /items/products?filter={
  "AND": [
    {"inStock": {"eq": true}},
    {"price": {"lt": 50}},
    {"category.slug": {"eq": "electronics"}}
  ]
}

// Products created in last 7 days
GET /items/products?filter={
  "createdAt": {"gte": "$NOW-DAYS_7"}
}

// Products with specific tags
GET /items/products?filter={
  "tags": {"arraycontains": ["featured", "sale"]}
}

// Search products
GET /items/products?search=wireless&searchFields=["name","description"]
```

### Query with Relations

```javascript
// Include category and reviews
GET /items/products?fields=["*","category.*","reviews.*"]

// Filter by relation
GET /items/products?filter={
  "category.name": {"eq": "Electronics"},
  "reviews.rating": {"gte": 4}
}

// Deep nesting
GET /items/products?fields=["*","category.parent.*","reviews.author.*"]
```

### relConditions (Filter Array Relations)

```javascript
// Only show approved reviews in products.reviews array
GET /items/products?fields=["*","reviews.*"]&relConditions={
  "reviews": {"approved": {"eq": true}, "rating": {"gte": 3}}
}

// Nested relConditions
GET /items/orders?fields=["*","items.*","items.product.*"]&relConditions={
  "items": {
    "quantity": {"gt": 0},
    "product": {"inStock": {"eq": true}}
  }
}
```

### Aggregation

```javascript
// Total revenue by category
GET /items/orders?aggregate={
  "revenue": {"function": "sum", "field": "total"},
  "count": {"function": "count", "field": "id"}
}&groupBy=["category_Id"]

// Average product price
GET /items/products?aggregate={
  "avgPrice": {"function": "avg", "field": "price"},
  "minPrice": {"function": "min", "field": "price"},
  "maxPrice": {"function": "max", "field": "price"}
}
```

### Sorting and Pagination

```javascript
// Sort by multiple fields
GET /items/products?sort={"category_Id":"asc","price":"desc"}

// Or array syntax
GET /items/products?sort=["-createdAt","name"]

// Pagination
GET /items/products?limit=20&page=1

// Get all (use carefully!)
GET /items/products?limit=-1
```

---

## Task: Create a Hook Extension

### File Structure
```
extensions/
  baasix-hook-products/
    index.js
```

### Complete Hook Example

```javascript
// extensions/baasix-hook-products/index.js
export default (hooksService, context) => {
  const { ItemsService, MailService, getCacheService } = context;

  // ==========================================
  // BEFORE CREATE - Validate & Transform
  // ==========================================
  hooksService.registerHook("products", "items.create", async ({
    data,
    accountability,
    collection,
    schema,
    db,
    transaction
  }) => {
    // Auto-generate SKU if not provided
    if (!data.sku) {
      const prefix = (data.name || "PRD").substring(0, 3).toUpperCase();
      data.sku = `${prefix}-${Date.now()}`;
    }

    // Ensure SKU is uppercase
    data.sku = data.sku.toUpperCase();

    // Add audit fields
    if (accountability?.user) {
      data.created_by = accountability.user.id;
    }

    // Generate slug from name
    if (data.name) {
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // MUST return modified data
    return { data };
  });

  // ==========================================
  // AFTER CREATE - Side Effects
  // ==========================================
  hooksService.registerHook("products", "items.create.after", async ({
    data,
    document,  // The created record with ID
    accountability,
    collection,
    db
  }) => {
    // Invalidate cache
    const cache = getCacheService();
    await cache.delete("products:list");
    await cache.delete(`products:category:${document.category_Id}`);

    // Send notification to admin
    if (document.price > 1000) {
      await MailService.sendMail({
        to: "admin@example.com",
        subject: "High-value product created",
        templateName: "high-value-product",
        context: { product: document }
      });
    }

    // Log activity (no return needed for after hooks)
    console.log(`Product created: ${document.id} by ${accountability?.user?.email}`);
  });

  // ==========================================
  // BEFORE READ - Filter/Modify Query
  // ==========================================
  hooksService.registerHook("products", "items.read", async ({
    query,
    accountability
  }) => {
    // Non-admins can only see published products
    if (accountability?.role?.name !== "administrator") {
      const existingFilter = query.filter ? JSON.parse(query.filter) : {};
      query.filter = JSON.stringify({
        AND: [
          existingFilter,
          { published: { eq: true } },
          { deletedAt: { isNull: true } }
        ]
      });
    }

    return { query };
  });

  // ==========================================
  // AFTER READ - Transform Results
  // ==========================================
  hooksService.registerHook("products", "items.read.after", async ({
    query,
    result,
    accountability
  }) => {
    // Add computed fields
    if (Array.isArray(result.data)) {
      result.data = result.data.map(item => ({
        ...item,
        displayPrice: `$${item.price.toFixed(2)}`,
        isOnSale: item.salePrice && item.salePrice < item.price
      }));
    }

    return { result };
  });

  // ==========================================
  // BEFORE UPDATE - Validation
  // ==========================================
  hooksService.registerHook("products", "items.update", async ({
    id,
    data,
    accountability
  }) => {
    // Prevent changing SKU after creation
    if (data.sku) {
      delete data.sku;
    }

    // Add audit fields
    if (accountability?.user) {
      data.updated_by = accountability.user.id;
    }

    // Update slug if name changed
    if (data.name) {
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    return { data };
  });

  // ==========================================
  // BEFORE DELETE - Prevent or Archive
  // ==========================================
  hooksService.registerHook("products", "items.delete", async ({
    id,
    accountability
  }) => {
    const productsService = new ItemsService("products", { accountability });
    const product = await productsService.readOne(id);

    // Check if product has orders
    const ordersService = new ItemsService("order_items", { accountability });
    const orders = await ordersService.readByQuery({
      filter: { product_Id: { eq: id } },
      limit: 1
    });

    if (orders.totalCount > 0) {
      // Archive instead of delete
      await productsService.updateOne(id, {
        archived: true,
        archivedAt: new Date()
      }, { bypassHooks: true });

      throw new Error("Product has orders and was archived instead of deleted");
    }
  });

  // ==========================================
  // WILDCARD HOOK - All Collections
  // ==========================================
  hooksService.registerHook("*", "items.create.after", async (ctx) => {
    // Log all creates
    console.log(`[${ctx.collection}] Created: ${ctx.document.id}`);
  });
};
```

---

## Task: Create an Endpoint Extension

### File Structure
```
extensions/
  baasix-endpoint-dashboard/
    index.js
```

### Complete Endpoint Example

```javascript
// extensions/baasix-endpoint-dashboard/index.js
import { APIError, ItemsService } from "@tspvivek/baasix";

export default {
  id: "dashboard-api",
  handler: (app, context) => {

    // ==========================================
    // PROTECTED ENDPOINT - Requires Auth
    // ==========================================
    app.get("/api/dashboard/stats", async (req, res, next) => {
      try {
        // Check authentication
        if (!req.accountability?.user) {
          throw new APIError("Authentication required", 401);
        }

        const { accountability } = req;

        // Initialize services
        const ordersService = new ItemsService("orders", { accountability });
        const productsService = new ItemsService("products", { accountability });
        const usersService = new ItemsService("baasix_User", { accountability });

        // Fetch stats in parallel
        const [orderStats, productStats, userStats] = await Promise.all([
          ordersService.readByQuery({
            filter: { status: { eq: "completed" } },
            aggregate: {
              revenue: { function: "sum", field: "total" },
              count: { function: "count", field: "id" }
            }
          }),
          productsService.readByQuery({
            filter: { inStock: { eq: true } },
            aggregate: { count: { function: "count", field: "id" } }
          }),
          usersService.readByQuery({
            filter: { status: { eq: "active" } },
            aggregate: { count: { function: "count", field: "id" } }
          })
        ]);

        res.json({
          data: {
            totalRevenue: orderStats.data[0]?.revenue || 0,
            totalOrders: orderStats.data[0]?.count || 0,
            activeProducts: productStats.data[0]?.count || 0,
            activeUsers: userStats.data[0]?.count || 0
          }
        });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // ROLE-BASED ENDPOINT - Admin Only
    // ==========================================
    app.get("/api/admin/reports/sales", async (req, res, next) => {
      try {
        if (!req.accountability?.user) {
          throw new APIError("Authentication required", 401);
        }

        if (req.accountability.role?.name !== "administrator") {
          throw new APIError("Admin access required", 403);
        }

        const { startDate, endDate, groupBy = "day" } = req.query;
        const { accountability } = req;

        const ordersService = new ItemsService("orders", { accountability });

        const filter = {
          AND: [
            { status: { eq: "completed" } },
            { createdAt: { gte: startDate || "$NOW-DAYS_30" } },
            { createdAt: { lte: endDate || "$NOW" } }
          ]
        };

        const result = await ordersService.readByQuery({
          filter,
          aggregate: {
            revenue: { function: "sum", field: "total" },
            count: { function: "count", field: "id" },
            avgOrder: { function: "avg", field: "total" }
          },
          groupBy: ["status"]
        });

        res.json({ data: result.data });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // PUBLIC ENDPOINT - No Auth
    // ==========================================
    app.post("/api/contact", async (req, res, next) => {
      try {
        const { name, email, message, subject } = req.body;

        // Validation
        if (!name || !email || !message) {
          throw new APIError("Name, email, and message are required", 400);
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new APIError("Invalid email format", 400);
        }

        // Save to database (no accountability = system context)
        const contactService = new ItemsService("contact_submissions", {});

        const id = await contactService.createOne({
          name,
          email,
          message,
          subject: subject || "General Inquiry",
          submittedAt: new Date(),
          status: "pending"
        });

        // Send notification email
        const { MailService } = context;
        await MailService.sendMail({
          to: "support@example.com",
          subject: `New Contact: ${subject || "General Inquiry"}`,
          templateName: "contact-notification",
          context: { name, email, message }
        });

        res.status(201).json({
          data: { id },
          message: "Thank you for your message"
        });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // PARAMETERIZED ENDPOINT
    // ==========================================
    app.get("/api/products/:slug", async (req, res, next) => {
      try {
        const { slug } = req.params;
        const { accountability } = req;

        const productsService = new ItemsService("products", { accountability });

        const result = await productsService.readByQuery({
          filter: { slug: { eq: slug } },
          fields: ["*", "category.*", "reviews.*", "reviews.author.firstName"],
          limit: 1
        });

        if (result.data.length === 0) {
          throw new APIError("Product not found", 404);
        }

        res.json({ data: result.data[0] });
      } catch (error) {
        next(error);
      }
    });

    // ==========================================
    // FILE UPLOAD ENDPOINT
    // ==========================================
    app.post("/api/products/:id/images", async (req, res, next) => {
      try {
        if (!req.accountability?.user) {
          throw new APIError("Authentication required", 401);
        }

        if (!req.files?.image) {
          throw new APIError("No image provided", 400);
        }

        const { id } = req.params;
        const { accountability } = req;
        const { FilesService } = context;

        // Upload file
        const filesService = new FilesService({ accountability });
        const fileId = await filesService.createOne(
          { file: req.files.image },
          {
            title: `Product ${id} Image`,
            storage: "local",
            folder: `products/${id}`
          }
        );

        // Link to product
        const productsService = new ItemsService("products", { accountability });
        await productsService.updateOne(id, {
          images: { push: fileId }  // Assuming images is an array
        });

        res.status(201).json({ data: { fileId } });
      } catch (error) {
        next(error);
      }
    });
  }
};
```

---

## Task: Create a Schedule Extension

```javascript
// extensions/baasix-schedule-cleanup/index.js
export default {
  id: "nightly-cleanup",
  schedule: "0 2 * * *",  // 2 AM daily

  handler: async (context) => {
    const { ItemsService, getCacheService } = context;
    const cache = getCacheService();

    // Clean old logs (30 days)
    const logsService = new ItemsService("activity_logs", {});
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const oldLogs = await logsService.readByQuery({
      filter: { createdAt: { lt: cutoffDate.toISOString() } },
      fields: ["id"],
      limit: -1
    });

    if (oldLogs.data.length > 0) {
      await logsService.deleteMany(oldLogs.data.map(l => l.id));
      console.log(`Deleted ${oldLogs.data.length} old logs`);
    }

    // Clean expired sessions (7 days)
    const sessionsService = new ItemsService("baasix_Session", {});
    const sessionCutoff = new Date();
    sessionCutoff.setDate(sessionCutoff.getDate() - 7);

    const expiredSessions = await sessionsService.readByQuery({
      filter: { lastActivity: { lt: sessionCutoff.toISOString() } },
      fields: ["id"],
      limit: -1
    });

    if (expiredSessions.data.length > 0) {
      await sessionsService.deleteMany(expiredSessions.data.map(s => s.id));
      console.log(`Deleted ${expiredSessions.data.length} expired sessions`);
    }

    // Clear cache
    await cache.delete("dashboard:*");
    console.log("Cache cleared");
  }
};
```

---

## Task: Set Up Permissions

### Permission Structure

```javascript
// POST /permissions
{
  "role_Id": "user-role-uuid",
  "collection": "products",
  "action": "read",              // read, create, update, delete
  "fields": ["*"],               // or ["name", "price", "description"]
  "conditions": {                // Row-level filtering
    "published": {"eq": true}
  }
}
```

### Common Permission Patterns

```javascript
// Public can read published products
{
  "role_Id": "public-role-uuid",
  "collection": "products",
  "action": "read",
  "fields": ["id", "name", "price", "description", "images"],
  "conditions": {"published": {"eq": true}}
}

// Users can only edit their own posts
{
  "role_Id": "user-role-uuid",
  "collection": "posts",
  "action": "update",
  "fields": ["title", "content"],
  "conditions": {"author_Id": {"eq": "$CURRENT_USER"}}
}

// Admin full access (no conditions)
{
  "role_Id": "admin-role-uuid",
  "collection": "*",  // All collections
  "action": "read",
  "fields": ["*"]
}
```

---

## Common Patterns & Solutions

### Pattern: Soft Delete with Paranoid

```javascript
// Schema
{
  "schema": {
    "paranoid": true,  // Adds deletedAt field
    "fields": {...}
  }
}

// Query excludes deleted by default
GET /items/products

// Include deleted records
GET /items/products?paranoid=false

// Restore deleted
await service.restore(id);
```

### Pattern: Multi-Tenant Isolation

```javascript
// Enable in .env
MULTI_TENANT=true

// All queries automatically filter by tenant
// Hooks receive tenant context
hooksService.registerHook("orders", "items.create", async ({ data, accountability }) => {
  data.tenant_Id = accountability.tenant;
  return { data };
});
```

### Pattern: Full-Text Search

```javascript
// Search across multiple fields
GET /items/products?search=wireless headphones&searchFields=["name","description","tags"]

// Combine with filters
GET /items/products?search=laptop&filter={"category.slug":"electronics","inStock":true}
```

### Pattern: Geospatial Queries

```javascript
// Find stores within 10km
GET /items/stores?filter={
  "location": {
    "dwithin": {
      "geometry": {"type": "Point", "coordinates": [-73.9857, 40.7484]},
      "distance": 10000
    }
  }
}

// Sort by distance
GET /items/stores?sort={
  "_distance": {
    "target": [-73.9857, 40.7484],
    "column": "location",
    "direction": "ASC"
  }
}
```

### Pattern: Nested Relations with Filtering

```javascript
// Get orders with filtered items
GET /items/orders?fields=["*","items.*","items.product.*"]&filter={
  "status": {"eq": "completed"}
}&relConditions={
  "items": {
    "quantity": {"gt": 0},
    "product": {
      "inStock": {"eq": true}
    }
  }
}
```

---

## Error Handling Best Practices

```javascript
import { APIError } from "@tspvivek/baasix";

// In endpoints/hooks
try {
  // Your code
} catch (error) {
  if (error instanceof APIError) {
    throw error;  // Re-throw APIError as-is
  }
  console.error("Unexpected error:", error);
  throw new APIError("An unexpected error occurred", 500);
}

// Common error codes
throw new APIError("Resource not found", 404);
throw new APIError("Invalid request data", 400);
throw new APIError("Authentication required", 401);
throw new APIError("Permission denied", 403);
throw new APIError("Resource already exists", 409);
throw new APIError("Rate limit exceeded", 429);
```

---

## Testing Guide

```javascript
import request from "supertest";
import { app } from "./setup"; // Your test setup

describe("Products API", () => {
  let adminToken, userToken, productId;

  beforeAll(async () => {
    // Login as admin
    const adminRes = await request(app)
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "admin123" });
    adminToken = adminRes.body.token;

    // Login as regular user
    const userRes = await request(app)
      .post("/auth/login")
      .send({ email: "user@test.com", password: "user123" });
    userToken = userRes.body.token;
  });

  describe("CRUD Operations", () => {
    test("Admin can create product", async () => {
      const res = await request(app)
        .post("/items/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Test Product",
          price: 29.99,
          sku: "TEST-001",
          inStock: true
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      productId = res.body.data.id;
    });

    test("Read product with relations", async () => {
      const res = await request(app)
        .get(`/items/products/${productId}`)
        .query({ fields: JSON.stringify(["*", "category.*"]) })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Test Product");
    });

    test("Filter products", async () => {
      const filter = JSON.stringify({ inStock: { eq: true } });
      const res = await request(app)
        .get("/items/products")
        .query({ filter })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test("Update product", async () => {
      const res = await request(app)
        .patch(`/items/products/${productId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ price: 24.99 });

      expect(res.status).toBe(200);
    });

    test("Delete product", async () => {
      const res = await request(app)
        .delete(`/items/products/${productId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe("Permissions", () => {
    test("Unauthorized user cannot create", async () => {
      const res = await request(app)
        .post("/items/products")
        .send({ name: "Unauthorized" });

      expect(res.status).toBe(401);
    });

    test("Regular user cannot delete", async () => {
      const res = await request(app)
        .delete(`/items/products/${productId}`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });
  });
});
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes | - | PostgreSQL connection string |
| SECRET_KEY | Yes | - | JWT/encryption secret (32+ chars) |
| PORT | No | 8056 | HTTP port |
| LOG_LEVEL | No | info | Log level (fatal/error/warn/info/debug/trace) |
| CACHE_ENABLED | No | false | Enable caching |
| CACHE_ADAPTER | No | memory | Cache adapter (memory/redis/upstash) |
| CACHE_REDIS_URL | No | - | Redis URL for cache |
| CACHE_TTL | No | 300 | Cache TTL (seconds) |
| MULTI_TENANT | No | false | Enable multi-tenancy |
| SOCKET_ENABLED | No | false | Enable Socket.IO |
| PUBLIC_REGISTRATION | No | true | Allow public registration |
| RATE_LIMIT | No | 100 | Requests per interval |
| RATE_LIMIT_INTERVAL | No | 5000 | Rate limit interval (ms) |

---

## Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Check `Authorization: Bearer <token>` header
   - Verify token hasn't expired
   - Ensure user exists and is active

2. **403 Forbidden**
   - Check permissions for role/collection/action
   - Verify permission conditions match the data

3. **Filters not working**
   - Ensure filter is valid JSON in query string
   - Use correct operator syntax (eq, not =)
   - Check for typos in field names

4. **Relations not loading**
   - Include relation in fields: `["*", "relation.*"]`
   - Verify relationship exists in schema
   - Check permissions for related collection

5. **Extension not loading**
   - Verify folder name: `baasix-hook-{name}`, `baasix-endpoint-{name}`
   - Check for syntax errors in index.js
   - Ensure proper ES module export

6. **Cache issues**
   - Verify Redis connection
   - Check CACHE_REDIS_URL in .env
   - Manually invalidate: `invalidateCollection("collection")`

---

## CLI (Command Line Interface)

Baasix provides a CLI tool (`baasix`) for project scaffolding, type generation, and migrations.

### Installation

```bash
# Global installation
npm install -g baasix

# Or use npx
npx baasix <command>
```

### Configuration

Create a `.env` file with:

```env
BAASIX_URL=http://localhost:8056
BAASIX_EMAIL=admin@example.com
BAASIX_PASSWORD=your-password
# Or: BAASIX_TOKEN=your-jwt-token
```

### Commands

| Command | Description |
|---------|-------------|
| `baasix init [name]` | Initialize new project (-t api/nextjs) |
| `baasix generate` | Generate TypeScript types (-t types/sdk-types/schema-json) |
| `baasix extension [name]` | Scaffold extension (-t endpoint/hook) |
| `baasix migrate [action]` | Migration management (status/list/run/create/rollback/reset) |

### Quick Examples

```bash
# Create new API project
baasix init my-api -t api

# Generate TypeScript types
baasix generate -t types -o types/baasix.d.ts

# Create hook extension
baasix extension audit-log -t hook

# Create and run migrations
baasix migrate create -n add_products_table
baasix migrate run
baasix migrate rollback --steps 1
```

### Generated Types Usage

```typescript
import type { Products, Users } from "./types/baasix";
import { createBaasix } from "@tspvivek/baasix-sdk";

const baasix = createBaasix({ url: "http://localhost:8056" });

// Type-safe queries
const products = await baasix.items<Products>("products").list();
const user = await baasix.items<Users>("users").get("user-id");
```

### Migration File Structure

```javascript
// migrations/20240115120000_create_products_table.js
export async function up(baasix) {
  await baasix.schema.create("products", {
    name: "Products",
    timestamps: true,
    fields: {
      id: { type: "UUID", primaryKey: true, defaultValue: { type: "UUIDV4" } },
      name: { type: "String", allowNull: false, values: { length: 255 } },
      price: { type: "Decimal", values: { precision: 10, scale: 2 } },
    },
  });
}

export async function down(baasix) {
  await baasix.schema.delete("products");
}
```

---

## Version

- Package: @tspvivek/baasix@0.1.0-alpha.2
- Node.js: 18+
- PostgreSQL: 14+ (with PostGIS for geospatial)
- Redis: 6+ (for caching)
