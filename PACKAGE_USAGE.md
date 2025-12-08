# Baasix Package Usage Guide

## For Package Users (After Publishing)

### Installation

```bash
npm install @tspvivek/baasix-drizzle
```

### Basic Setup

**1. Create `server.js` in your project:**

```javascript
import { startServer } from "@tspvivek/baasix-drizzle";

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
```

**2. Create `.env` file:**

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=baasix
DB_USER=postgres
DB_PASSWORD=yourpassword

# Server
PORT=8056
SECRET_KEY=your-secret-key-here

# Cache
CACHE_REDIS_URL=redis://localhost:6379
CACHE_TTL=300000
```

**3. Create Extensions (Optional)**

Create an `extensions/` folder in your project:

```
your-project/
├── server.js
├── .env
├── extensions/
│   ├── baasix-hook-posts/
│   │   └── index.js
│   └── baasix-endpoint-custom/
│       └── index.js
└── package.json
```

**Extension Example (`extensions/baasix-hook-posts/index.js`):**

```javascript
import { ItemsService } from "@tspvivek/baasix-drizzle";

export default async (hooksService, context) => {
  hooksService.registerHook("posts", "items.create", async ({ data, accountability }) => {
    data.created_by = accountability.user.id;
    data.created_at = new Date();
    return { data };
  });
};
```

**4. Start your server:**

```bash
node server.js
```

---

## For Package Development

### Setup for Development

```bash
# Install dependencies
npm install

# Link package to itself for development
npm link
npm link @tspvivek/baasix-drizzle

# Run development server (uses tsx for TypeScript)
npm run development

# Or with watch mode
npm run dev
```

### Building the Package

```bash
# Build for production
npm run build

# Test production build
npm run start
```

### Package Structure

```
@tspvivek/baasix-drizzle/
├── dist/                    # Compiled output (published to npm)
│   ├── index.js             # Main entry point
│   ├── services/            # All services
│   ├── utils/               # Utilities
│   ├── routes/              # Built-in routes
│   └── templates/           # Email templates
├── baasix/                  # TypeScript source (not published)
├── examples/                # Usage examples
├── extensions/              # Example extensions
├── package.json
└── tsconfig.json
```

### Published Package Contents

Only the `dist/` folder is published to npm (defined in `package.json` files field):

```json
{
  "files": ["dist", "README.md", "LICENSE.MD"]
}
```

### Exports

The package exports:

```javascript
// Main server
import { startServer, app } from "@tspvivek/baasix-drizzle";

// Services (for extensions)
import { ItemsService, FilesService, MailService } from "@tspvivek/baasix-drizzle";

// Utilities
import { APIError, env, schemaManager } from "@tspvivek/baasix-drizzle";
```

---

## Testing Before Publishing

```bash
# 1. Build the package
npm run build

# 2. Pack it locally
npm pack

# 3. Install in a test project
cd /path/to/test-project
npm install /path/to/baasix/tspvivek-baasix-drizzle-0.1.0-alpha.tgz

# 4. Test it
node server.js
```

---

## Publishing to npm

```bash
# Login to npm
npm login

# Publish (for first time alpha release)
npm publish --access public --tag alpha

# Or for stable release
npm publish --access public
```
