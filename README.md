<p align="center">
  <img src="https://raw.githubusercontent.com/tspvivek/baasix/master/assets/banner_small.jpg" alt="Baasix Banner" />
</p>

<p align="center">
  <strong>A powerful, flexible Backend as a Service (BaaS) platform for rapid application development</strong>
</p>

<p align="center">
  <a href="https://baasix.com">Website</a> •
  <a href="https://baasix.com/docs">Documentation</a> •
  <a href="https://github.com/tspvivek/baasix-sample">Sample Project</a> •
  <a href="https://github.com/tspvivek/baasix">GitHub</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tspvivek/baasix"><img src="https://img.shields.io/npm/v/@tspvivek/baasix.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@tspvivek/baasix"><img src="https://img.shields.io/npm/dm/@tspvivek/baasix.svg" alt="npm downloads"></a>
  <a href="https://github.com/tspvivek/baasix/blob/master/LICENSE.MD"><img src="https://img.shields.io/npm/l/@tspvivek/baasix.svg" alt="license"></a>
</p>

---

## ✨ Features

- **🗄️ Dynamic Database Management** — Create and modify data models on the fly with a flexible schema system
- **🔍 Powerful Query API** — Complex filtering, sorting, pagination, aggregation, and full-text search
- **🔐 Authentication & Authorization** — JWT, cookie-based auth, SSO providers, and role-based permissions
- **⚡ Workflow Automation** — Visual workflow builder with 17 node types and real-time monitoring
- **🔔 Notification System** — Built-in user notifications with real-time delivery via Socket.IO
- **📁 File Storage & Processing** — Upload, manage, and transform files with image optimization
- **📝 Pino Logger** — High-performance structured logging with configurable transports (Datadog, Loki, etc.)
- **🌍 PostGIS Geospatial Support** — Advanced spatial data operations
- **📊 Reporting & Analytics** — Generate complex reports with grouping and aggregation
- **🪝 Hooks System** — Extend functionality with custom hooks on CRUD operations
- **🏢 Multi-tenant Architecture** — Host multiple isolated organizations in a single instance
- **⚡ Real-time Updates** — Socket.IO integration with Redis clustering
- **🚀 High Performance** — Redis-based caching with configurable TTL

---

## 🚀 Quick Start

### 1. Create a new project

```bash
mkdir my-baasix-app
cd my-baasix-app
npm init -y
```

### 2. Install Baasix

```bash
npm install @tspvivek/baasix
```

### 3. Create server.js

```javascript
import { startServer } from "@tspvivek/baasix";

// Basic usage - pretty printing in dev, JSON in production
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

// With custom logger configuration
startServer({
  port: 8056,
  logger: {
    level: "info",      // 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
    pretty: true,       // Human-readable output (default in development)
  }
});
```

### 4. Configure package.json

```json
{
  "type": "module",
  "scripts": {
    "start": "node server.js"
  }
}
```

### 5. Create .env file

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=baasix
DB_USER=postgres
DB_PASSWORD=yourpassword

PORT=8056
SECRET_KEY=your-secret-key-min-32-chars

CACHE_REDIS_URL=redis://localhost:6379
```

### 6. Start the server

```bash
npm start
```

Visit `http://localhost:8056/` to verify the server is running.

---

## 📋 Requirements

- **Node.js** 18+
- **PostgreSQL** 14+ with PostGIS extension
- **Redis** 6+

---

## 📚 Documentation

Full documentation is available at **[baasix.com/docs](https://baasix.com/docs)**

### Popular Guides

- [Deployment Guide](https://baasix.com/docs/deployment-guide) — Docker, PM2, Kubernetes deployment
- [Database Schema Guide](https://baasix.com/docs/database-schema-guide) — Schema system and relationships
- [Authentication Guide](https://baasix.com/docs/authentication-routes-docs) — Auth setup and SSO providers
- [Extensions Guide](https://baasix.com/docs/baasix-extensions-docs) — Create custom hooks and endpoints
- [Advanced Query Guide](https://baasix.com/docs/advanced-query-guide) — Complex filtering and aggregation

---

## 📦 Sample Project

Get started quickly with our complete sample project:

👉 **[github.com/tspvivek/baasix-sample](https://github.com/tspvivek/baasix-sample)**

Includes:
- Ready-to-use server configuration
- Docker deployment files
- PM2 ecosystem configurations
- Kubernetes manifests
- Example extensions (hooks & endpoints)
- MCP configuration files for AI-powered development

---

## 🤖 MCP Server (AI Integration)

Baasix includes a Model Context Protocol (MCP) server that enables AI assistants like Claude, GitHub Copilot, and Cursor to interact directly with your Baasix backend.

👉 **[Baasix MCP Server](https://github.com/tspvivek/baasix-mcp-server)** | **[npm: @tspvivek/baasix-mcp-server](https://www.npmjs.com/package/@tspvivek/baasix-mcp-server)**

### Features
- **40+ MCP Tools** for comprehensive Baasix operations
- **Schema Management** — Create, update, delete collections and relationships
- **CRUD Operations** — Full item management with powerful query capabilities
- **50+ Filter Operators** — From basic comparison to geospatial and JSONB queries
- **Permissions** — Role-based access control management
- **Authentication** — Login, register, magic links, invitations

### Quick Setup

**For Claude Code / Anthropic CLI** — Create `.mcp.json` in your project:
```json
{
  "mcpServers": {
    "baasix": {
      "command": "npx",
      "args": ["@tspvivek/baasix-mcp-server"],
      "env": {
        "BAASIX_URL": "http://localhost:8056",
        "BAASIX_EMAIL": "admin@baasix.com",
        "BAASIX_PASSWORD": "admin@123"
      }
    }
  }
}
```

**For VS Code with GitHub Copilot** — Create `.vscode/mcp.json`:
```jsonc
{
  "servers": {
    "baasix": {
      "type": "stdio",
      "command": "npx",
      "args": ["@tspvivek/baasix-mcp-server"],
      "env": {
        "BAASIX_URL": "http://localhost:8056",
        "BAASIX_EMAIL": "admin@baasix.com",
        "BAASIX_PASSWORD": "admin@123"
      }
    }
  }
}
```

For more configuration options and examples, see the [MCP Server documentation](https://github.com/tspvivek/baasix-mcp-server).

---

## 🔧 Extensions

Extend Baasix with custom hooks and endpoints:

```javascript
// extensions/baasix-hook-example/index.js
import { ItemsService } from "@tspvivek/baasix";

export default (hooksService, context) => {
  hooksService.registerHook("posts", "items.create", async ({ data, accountability }) => {
    data.created_by = accountability.user.id;
    data.created_at = new Date();
    return { data };
  });
};
```

```javascript
// extensions/baasix-endpoint-example/index.js
import { APIError } from "@tspvivek/baasix";

export default {
  id: "custom-endpoint",
  handler: (app, context) => {
    app.get("/custom", async (req, res, next) => {
      res.json({ message: "Hello from custom endpoint!" });
    });
  },
};
```

---

## 🛠️ Available Exports

```javascript
// Server
import { startServer, app } from "@tspvivek/baasix";

// Services
import { 
  ItemsService, 
  FilesService, 
  MailService,
  NotificationService,
  PermissionService,
  WorkflowService 
} from "@tspvivek/baasix";

// Utilities
import { 
  APIError, 
  env, 
  schemaManager,
  getDatabase,
  getSqlClient 
} from "@tspvivek/baasix";

// Logger
import { getLogger, initializeLogger } from "@tspvivek/baasix";
```

---

## 🤝 Contributing

Contributions are welcome! Please visit our [GitHub repository](https://github.com/tspvivek/baasix) to:

- Report bugs
- Request features
- Submit pull requests

---

## 📄 License

This package contains components with different licenses:

| Component | License | Open Source |
|-----------|---------|-------------|
| Core API & Backend | MIT | ✅ Yes |
| Plugins & Utilities | MIT | ✅ Yes |
| Admin Dashboard (`app/`) | Proprietary | ❌ No |

See the [LICENSE.MD](./LICENSE.MD) file for complete details.

---

<p align="center">
  <sub>Built with ❤️ by the Baasix team</sub>
</p>
