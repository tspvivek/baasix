import { Express } from "express";
import env from "../utils/env.js";
import fs from "fs";
import path from "path";
import { schemaManager } from "../utils/schemaManager.js";
import { APIError } from "../utils/errorHandler.js";
import settingsService from "../services/SettingsService.js";
import { getProjectPath } from "../utils/dirname.js";

const registerEndpoint = (app: Express) => {
    // OpenAPI specification endpoint
    app.get("/openapi", async (req, res, next) => {
        try {
            const projectInfo = await settingsService.getProjectInfo();

            const baseUrl = projectInfo?.project?.url || "http://localhost:8056";

            const openApiSpec = await generateOpenApiSpec(baseUrl);
            res.status(200).json(openApiSpec);
        } catch (error: any) {
            next(new APIError("Error generating OpenAPI specification", 500, error.message));
        }
    });

    // Swagger UI endpoint
    app.get("/docs", async (req, res) => {
        const projectInfo = await settingsService.getProjectInfo();

        const baseUrl = projectInfo?.project?.url || "http://localhost:8056";
        const swaggerHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Baasix API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.0.0/swagger-ui.css" />
    <style>
        html {
            box-sizing: border-box;
            overflow: -moz-scrollbars-vertical;
            overflow-y: scroll;
        }
        *, *:before, *:after {
            box-sizing: inherit;
        }
        body {
            margin:0;
            background: #fafafa;
        }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.0.0/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.0.0/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                url: '${baseUrl}/openapi',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout",
                tryItOutEnabled: false,
                requestInterceptor: function(req) {
                    // Add any auth headers or other request modifications here
                    return req;
                }
            });
        };
    </script>
</body>
</html>`;
        res.send(swaggerHtml);
    });
};

interface EndpointInfo {
    path: string;
    method: string;
    type: string;
    category: string;
    description: string;
    collectionName?: string;
    schema?: any;
    extensionId?: string;
}

function getSystemEndpoints(): EndpointInfo[] {

    const authEndpoints = env.get("OPENAPI_INCLUDE_AUTH") === "true" ? [
        // Auth endpoints
        { path: "/auth/register", method: "POST", type: "system", category: "authentication", description: "Register a new user" },
        { path: "/auth/login", method: "POST", type: "system", category: "authentication", description: "Login user" },
        { path: "/auth/logout", method: "GET", type: "system", category: "authentication", description: "Logout user" },
        { path: "/auth/me", method: "GET", type: "system", category: "authentication", description: "Get current user info" },
        { path: "/auth/magiclink", method: "POST", type: "system", category: "authentication", description: "Send magic link" },
        { path: "/auth/magiclink/{token}", method: "GET", type: "system", category: "authentication", description: "Login with magic link" },
    ] : [];

    const multiTenantEndpoints = env.get("OPENAPI_INCLUDE_MULTI_TENANT") === "true" ? [
        // Multi-tenant endpoints
        { path: "/auth/tenants", method: "GET", type: "system", category: "authentication", description: "Get user tenants" },
        { path: "/auth/switch-tenant", method: "POST", type: "system", category: "authentication", description: "Switch user tenant" },
        { path: "/auth/invite", method: "POST", type: "system", category: "authentication", description: "Send user invitation" },
        { path: "/auth/accept-invite", method: "POST", type: "system", category: "authentication", description: "Accept user invitation" },
        { path: "/auth/verify-invite/{token}", method: "GET", type: "system", category: "authentication", description: "Verify invitation token" },
    ] : [];

    const schemaEndpoints = env.get("OPENAPI_INCLUDE_SCHEMA") === "true" ? [
        // Schema management endpoints
        { path: "/schemas", method: "GET", type: "system", category: "schema", description: "Get all schemas" },
        { path: "/schemas", method: "POST", type: "system", category: "schema", description: "Create new schema" },
        { path: "/schemas/{collectionName}", method: "GET", type: "system", category: "schema", description: "Get specific schema" },
        { path: "/schemas/{collectionName}", method: "DELETE", type: "system", category: "schema", description: "Delete schema" },
        { path: "/schemas/{collectionName}/indexes", method: "POST", type: "system", category: "schema", description: "Create schema index" },
        { path: "/schemas/{collectionName}/indexes/{indexName}", method: "DELETE", type: "system", category: "schema", description: "Delete schema index" },
        { path: "/schemas/{sourceCollection}/relationships", method: "POST", type: "system", category: "schema", description: "Create relationship" },
        { path: "/schemas/{sourceCollection}/relationships/{fieldName}", method: "DELETE", type: "system", category: "schema", description: "Delete relationship" },
        { path: "/schemas-export", method: "GET", type: "system", category: "schema", description: "Export schemas" },
        { path: "/schemas-import", method: "POST", type: "system", category: "schema", description: "Import schemas" },
    ] : [];

    const permissionEndpoints = env.get("OPENAPI_INCLUDE_PERMISSIONS") === "true" ? [
        // Permission endpoints
        { path: "/permissions", method: "GET", type: "system", category: "permissions", description: "Get permissions" },
        { path: "/permissions", method: "POST", type: "system", category: "permissions", description: "Create permission" },
        { path: "/permissions/{id}", method: "GET", type: "system", category: "permissions", description: "Get specific permission" },
        { path: "/permissions/{id}", method: "DELETE", type: "system", category: "permissions", description: "Delete permission" },
        { path: "/permissions/reload", method: "POST", type: "system", category: "permissions", description: "Reload permissions" },

        // Permission management endpoints
        { path: "/permissions-export", method: "GET", type: "system", category: "schema", description: "Export permissions" },
        { path: "/permissions-import", method: "POST", type: "system", category: "schema", description: "Import permissions" },
        { path: "/permissions-import-with-data", method: "POST", type: "system", category: "schema", description: "Import permissions with data" },
    ] : [];

    const settingsEndpoints = env.get("OPENAPI_INCLUDE_SETTINGS") === "true" ? [
        // Settings endpoints
        { path: "/", method: "GET", type: "system", category: "settings", description: "Get app info" },
        { path: "/", method: "POST", type: "system", category: "settings", description: "Update app info" },
        { path: "/settings/{id}", method: "GET", type: "system", category: "settings", description: "Get settings" },
        { path: "/settings/reload", method: "POST", type: "system", category: "settings", description: "Reload settings" },
    ] : [];

    const utilsEndpoints = env.get("OPENAPI_INCLUDE_UTILS") === "true" ? [
        // Utility endpoints
        { path: "/utils/sort/{collection}", method: "POST", type: "system", category: "utils", description: "Sort items in collection" },
    ] : [];

    const notificationEndpoints = env.get("OPENAPI_INCLUDE_NOTIFICATIONS") === "true" ? [
        // Notification endpoints
        { path: "/notifications", method: "GET", type: "system", category: "notifications", description: "Get user notifications" },
        { path: "/notifications", method: "DELETE", type: "system", category: "notifications", description: "Delete notifications" },
        { path: "/notifications/unread/count", method: "GET", type: "system", category: "notifications", description: "Get unread notifications count" },
        { path: "/notifications/mark-seen", method: "POST", type: "system", category: "notifications", description: "Mark notifications as seen" },
        { path: "/notifications/send", method: "POST", type: "system", category: "notifications", description: "Send notifications (admin)" },
        { path: "/notifications/cleanup", method: "POST", type: "system", category: "notifications", description: "Cleanup old notifications (admin)" },
    ] : [];

    const realtimeEndpoints = [
        // Realtime WAL endpoints (PostgreSQL logical replication)
        { path: "/realtime/status", method: "GET", type: "system", category: "realtime", description: "Get realtime service status (admin)" },
        { path: "/realtime/config", method: "GET", type: "system", category: "realtime", description: "Get PostgreSQL replication configuration (admin)" },
        { path: "/realtime/collections", method: "GET", type: "system", category: "realtime", description: "Get list of realtime-enabled collections (admin)" },
        { path: "/realtime/collections/{collection}", method: "GET", type: "system", category: "realtime", description: "Check if collection has realtime enabled (admin)" },
        { path: "/realtime/collections/{collection}/enable", method: "POST", type: "system", category: "realtime", description: "Enable realtime for collection (admin)" },
        { path: "/realtime/collections/{collection}/disable", method: "POST", type: "system", category: "realtime", description: "Disable realtime for collection (admin)" },
        { path: "/realtime/initialize", method: "POST", type: "system", category: "realtime", description: "Initialize realtime service manually (admin)" },
    ];

    const systemEndpoints = [
        ...authEndpoints,
        ...multiTenantEndpoints,
        ...schemaEndpoints,
        ...permissionEndpoints,
        ...settingsEndpoints,
        // File endpoints
        { path: "/files", method: "GET", type: "system", category: "files", description: "Get all files" },
        { path: "/files", method: "POST", type: "system", category: "files", description: "Upload file" },
        { path: "/files/{id}", method: "GET", type: "system", category: "files", description: "Get specific file" },
        { path: "/files/{id}", method: "PATCH", type: "system", category: "files", description: "Update file" },
        { path: "/files/{id}", method: "DELETE", type: "system", category: "files", description: "Delete file" },
        { path: "/files/upload-from-url", method: "POST", type: "system", category: "files", description: "Upload file from URL" },
        { path: "/assets/{id}", method: "GET", type: "system", category: "files", description: "Get file asset" },
        ...notificationEndpoints,
        ...utilsEndpoints,
        ...realtimeEndpoints,
    ];

    return systemEndpoints;
}

function getExtensionEndpoints(): EndpointInfo[] {
    const extensionEndpoints: EndpointInfo[] = [];
    const extensionsPath = getProjectPath("extensions");

    if (!fs.existsSync(extensionsPath)) {
        return extensionEndpoints;
    }

    try {
        const extensionDirs = fs.readdirSync(extensionsPath);

        for (const dir of extensionDirs) {
            const fullPath = path.join(extensionsPath, dir);

            if (fs.lstatSync(fullPath).isDirectory() && dir.startsWith("baasix-endpoint")) {
                const indexPath = path.join(fullPath, "index.js");

                if (fs.existsSync(indexPath)) {
                    try {
                        // Note: Extension modules are already loaded by router.ts using dynamic import
                        // We just need to know they exist for OpenAPI documentation
                        const endpointName = dir.replace("baasix-endpoint-", "");

                        extensionEndpoints.push({
                            path: `/${endpointName}`,
                            method: "GET", // Default method, could be enhanced to detect actual methods
                            type: "extension",
                            category: "custom",
                            description: `Custom endpoint: ${endpointName}`,
                            extensionId: dir
                        });
                    } catch (error: any) {
                        console.warn(`Error reading extension ${dir}:`, error.message);
                    }
                }
            }
        }
    } catch (error: any) {
        console.warn("Error reading extensions directory:", error.message);
    }

    return extensionEndpoints;
}

async function getCollectionEndpoints(): Promise<EndpointInfo[]> {
    const collectionEndpoints: EndpointInfo[] = [];

    try {
        const schemas = schemaManager.getAllSchemas();

        for (const [collectionName, schemaRecord] of Object.entries(schemas)) {
            // Skip system collections
            if (collectionName.startsWith('baasix_')) {
                continue;
            }

            // Standard CRUD endpoints for each collection
            const crudEndpoints = [
                { path: `/items/${collectionName}`, method: "GET", description: `Get all ${collectionName} items` },
                { path: `/items/${collectionName}`, method: "POST", description: `Create new ${collectionName} item` },
                { path: `/items/${collectionName}/{id}`, method: "GET", description: `Get specific ${collectionName} item` },
                { path: `/items/${collectionName}/{id}`, method: "PUT", description: `Update ${collectionName} item` },
                { path: `/items/${collectionName}/{id}`, method: "PATCH", description: `Partially update ${collectionName} item` },
                { path: `/items/${collectionName}/{id}`, method: "DELETE", description: `Delete ${collectionName} item` }
            ];

            for (const endpoint of crudEndpoints) {
                collectionEndpoints.push({
                    ...endpoint,
                    type: "collection",
                    category: "data",
                    collectionName: collectionName,
                    schema: schemaRecord
                });
            }
        }
    } catch (error: any) {
        console.warn("Error retrieving collection endpoints:", error.message);
    }

    return collectionEndpoints;
}

async function generateOpenApiSpec(baseUrl: string) {
    const endpoints: EndpointInfo[] = [];

    if( env.get("OPENAPI_ENABLED") === "false" || env.get("OPENAPI_ENABLED") === "0" ) {
        throw new APIError("OpenAPI generation is disabled", 503);
    }

    // Get system endpoints
    const systemEndpoints = getSystemEndpoints();
    endpoints.push(...systemEndpoints);

    // Get extension endpoints
    const extensionEndpoints = getExtensionEndpoints();
    endpoints.push(...extensionEndpoints);

    // Get collection endpoints
    const collectionEndpoints = await getCollectionEndpoints();
    endpoints.push(...collectionEndpoints);

    const RegisterRequest = env.get("MULTI_TENANT") === "true" ? {
        type: "object",
        properties: {
            email: { type: "string", format: "email", description: "User email address" },
            password: { type: "string", minLength: 8, description: "User password (minimum 8 characters)" },
            firstName: { type: "string", description: "User first name" },
            lastName: { type: "string", description: "User last name" },
            tenant: {
                type: "object",
                description: "Tenant information (required in multi-tenant mode)",
                properties: {
                    name: { type: "string", description: "Tenant name" }
                }
            },
            roleName: { type: "string", description: "Role name to assign" },
            inviteToken: { type: "string", description: "Invitation token if registering via invite" },
            authMode: { type: "string", enum: ["jwt", "cookie"], default: "jwt", description: "Authentication mode" }
        },
        required: ["email", "password", "firstName"]
    } : {
        type: "object",
        properties: {
            email: { type: "string", format: "email", description: "User email address" },
            password: { type: "string", minLength: 8, description: "User password (minimum 8 characters)" },
            firstName: { type: "string", description: "User first name" },
            lastName: { type: "string", description: "User last name" },
            authMode: { type: "string", enum: ["jwt", "cookie"], default: "jwt", description: "Authentication mode" }
        },
        required: ["email", "password", "firstName"]
    };

    const openApiSpec: any = {
        openapi: "3.0.3",
        info: {
            title: "Baasix API",
            description: "Backend as a Service API with dynamic collections and system endpoints",
            version: "1.0.0",
            contact: {
                name: "Baasix API Support"
            }
        },
        servers: [
            {
                url: baseUrl,
                description: "Baasix API Server"
            }
        ],
        paths: {},
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT"
                },
                cookieAuth: {
                    type: "apiKey",
                    in: "cookie",
                    name: "token"
                }
            },
            schemas: {
                Error: {
                    type: "object",
                    properties: {
                        message: { type: "string", description: "Error message" },
                        error: { type: "string", description: "Error details" },
                        statusCode: { type: "integer", description: "HTTP status code" }
                    },
                    required: ["message"]
                },
                PaginatedResponse: {
                    type: "object",
                    properties: {
                        data: {
                            type: "array",
                            items: {},
                            description: "Array of items"
                        },
                        totalCount: {
                            type: "integer",
                            description: "Total number of items available"
                        },
                        page: {
                            type: "integer",
                            description: "Current page number (1-based)"
                        },
                        limit: {
                            type: "integer",
                            description: "Number of items per page"
                        }
                    },
                    required: ["data"]
                },
                SingleItemResponse: {
                    type: "object",
                    properties: {
                        data: {
                            type: "object",
                            description: "Single item data"
                        }
                    },
                    required: ["data"]
                },
                CreateResponse: {
                    type: "object",
                    properties: {
                        data: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "ID of the created item"
                                }
                            },
                            required: ["id"]
                        }
                    },
                    required: ["data"]
                },
                // Auth Schemas
                RegisterRequest: RegisterRequest,
                LoginRequest: {
                    type: "object",
                    properties: {
                        email: { type: "string", format: "email", description: "User email address" },
                        password: { type: "string", description: "User password" },
                        authMode: { type: "string", enum: ["jwt", "cookie"], default: "jwt", description: "Authentication mode" },
                        otp: { type: "string", description: "One-time password (if 2FA is enabled)" }
                    },
                    required: ["email", "password"]
                },
                AuthResponse: {
                    type: "object",
                    properties: {
                        data: {
                            type: "object",
                            properties: {
                                access_token: { type: "string", description: "JWT access token" },
                                refresh_token: { type: "string", description: "JWT refresh token" },
                                expires: { type: "integer", description: "Token expiration timestamp" },
                                user: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string", description: "User ID" },
                                        email: { type: "string", description: "User email" },
                                        firstName: { type: "string", description: "User first name" },
                                        lastName: { type: "string", description: "User last name" }
                                    }
                                }
                            }
                        }
                    }
                },
                // ... (continuing in next part due to length)
            }
        },
        security: [
            { bearerAuth: [] },
            { cookieAuth: [] }
        ]
    };

    // Add comprehensive system schemas
    openApiSpec.components.schemas = {
        ...openApiSpec.components.schemas,
        ...getSystemSchemas()
    };

    // Generate and add dynamic collection schemas
    const collectionSchemas = generateCollectionSchemas(endpoints);
    Object.assign(openApiSpec.components.schemas, collectionSchemas);

    // Generate detailed paths with proper schemas
    const pathGroups: any = {};

    for (const endpoint of endpoints) {
        const { path: endpointPath, method } = endpoint;

        if (!pathGroups[endpointPath]) {
            pathGroups[endpointPath] = {};
        }

        // Create detailed operation based on endpoint type and method
        const operation = createDetailedOperation(endpoint);
        pathGroups[endpointPath][method.toLowerCase()] = operation;
    }

    openApiSpec.paths = pathGroups;

    return openApiSpec;
}

function getSystemSchemas() {
    return {
        // Schema Management
        Schema: {
            type: "object",
            properties: {
                collectionName: { type: "string", description: "Name of the collection" },
                schema: {
                    type: "object",
                    description: "Schema definition",
                    properties: {
                        name: { type: "string", description: "Schema display name" },
                        fields: {
                            type: "object",
                            description: "Field definitions",
                            additionalProperties: {
                                type: "object",
                                properties: {
                                    type: {
                                        type: "string",
                                        enum: ["String", "Integer", "Double", "Boolean", "UUID", "Date", "Text", "JSON"],
                                        description: "Field data type"
                                    },
                                    allowNull: { type: "boolean", description: "Whether field can be null" },
                                    defaultValue: { description: "Default value for the field" },
                                    primaryKey: { type: "boolean", description: "Whether field is primary key" },
                                    unique: { type: "boolean", description: "Whether field must be unique" },
                                    relType: {
                                        type: "string",
                                        enum: ["BelongsTo", "HasMany", "HasOne", "BelongsToMany"],
                                        description: "Relationship type"
                                    },
                                    target: { type: "string", description: "Target collection for relationships" },
                                    foreignKey: { type: "string", description: "Foreign key field name" }
                                }
                            }
                        },
                        timestamps: { type: "boolean", description: "Whether to include createdAt/updatedAt fields" },
                        indexes: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string", description: "Index name" },
                                    fields: {
                                        type: "array",
                                        items: { type: "string" },
                                        description: "Fields included in the index"
                                    },
                                    unique: { type: "boolean", description: "Whether index is unique" }
                                }
                            }
                        }
                    }
                },
                createdAt: { type: "string", format: "date-time" },
                updatedAt: { type: "string", format: "date-time" }
            }
        },
        // File Management
        FileUploadResponse: {
            type: "object",
            properties: {
                data: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "File ID" },
                        filename_disk: { type: "string", description: "File name on disk" },
                        filename_download: { type: "string", description: "Original filename" },
                        title: { type: "string", description: "File title" },
                        type: { type: "string", description: "MIME type" },
                        filesize: { type: "integer", description: "File size in bytes" },
                        uploaded_on: { type: "string", format: "date-time", description: "Upload timestamp" }
                    }
                }
            }
        },
        // Notification specific responses
        NotificationListResponse: {
            type: "object",
            properties: {
                data: {
                    type: "array",
                    items: { $ref: "#/components/schemas/baasix_Notification" },
                    description: "List of notifications"
                },
                totalCount: { type: "integer", description: "Total number of notifications" },
                page: { type: "integer", description: "Current page number" },
                limit: { type: "integer", description: "Number of items per page" }
            }
        },
        NotificationCountResponse: {
            type: "object",
            properties: {
                count: { type: "integer", description: "Number of unread notifications" }
            }
        },
        // Auth related request/response schemas
        InviteRequest: {
            type: "object",
            properties: {
                email: { type: "string", format: "email", description: "Email to invite" },
                roleName: { type: "string", description: "Role to assign" },
                tenant: { type: "object", description: "Tenant information" }
            },
            required: ["email", "roleName"]
        },
        SwitchTenantRequest: {
            type: "object",
            properties: {
                tenantId: { type: "string", format: "uuid", description: "Tenant ID to switch to" }
            },
            required: ["tenantId"]
        },
        MagicLinkRequest: {
            type: "object",
            properties: {
                email: { type: "string", format: "email", description: "Email address" },
                link: { type: "string", description: "Magic link URL" },
                mode: { type: "string", enum: ["link", "code"], description: "Mode of the magic link", default: "link" }
            },
            required: ["email"]
        },
        // System Models
        baasix_SchemaDefinition: {
            type: "object",
            properties: {
                collectionName: { type: "string", description: "Collection name (primary key)" },
                schema: { type: "object", description: "JSON schema definition" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" }
            },
            required: ["collectionName", "schema"]
        },
        baasix_Role: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Role ID" },
                name: { type: "string", description: "Role name" },
                description: { type: "string", description: "Role description" },
                isTenantSpecific: { type: "boolean", description: "Whether role is tenant-specific", default: true },
                canInviteRoleIds: { type: "array", items: { type: "string" }, description: "Array of role IDs this role can invite" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                permissions: { type: "array", items: { $ref: "#/components/schemas/baasix_Permission" }, description: "Role permissions" },
                userRoles: { type: "array", items: { $ref: "#/components/schemas/baasix_UserRole" }, description: "User role assignments" }
            },
            required: ["id", "name", "isTenantSpecific"]
        },
        baasix_Permission: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Permission ID" },
                action: { type: "string", description: "Action (create, read, update, delete, etc.)" },
                collection: { type: "string", description: "Collection name" },
                role_Id: { type: "string", format: "uuid", description: "Role ID" },
                fields: { type: "object", description: "Field-level permissions" },
                defaultValues: { type: "object", description: "Default values for new items" },
                conditions: { type: "object", description: "Access conditions" },
                relConditions: { type: "object", description: "Relational conditions" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                role: { $ref: "#/components/schemas/baasix_Role", description: "Associated role" }
            },
            required: ["id", "action", "collection", "role_Id"]
        },
        baasix_UserRole: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "UserRole ID" },
                user_Id: { type: "string", format: "uuid", description: "User ID" },
                role_Id: { type: "string", format: "uuid", description: "Role ID" },
                tenant_Id: { type: "string", format: "uuid", description: "Tenant ID" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                user: { $ref: "#/components/schemas/baasix_User", description: "Associated user" },
                role: { $ref: "#/components/schemas/baasix_Role", description: "Associated role" },
                tenant: { $ref: "#/components/schemas/baasix_Tenant", description: "Associated tenant" }
            },
            required: ["id", "user_Id", "role_Id"]
        },
        baasix_Tenant: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Tenant ID" },
                name: { type: "string", description: "Tenant name" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                userRoles: { type: "array", items: { $ref: "#/components/schemas/baasix_UserRole" }, description: "User role assignments" }
            },
            required: ["id", "name"]
        },
        baasix_User: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "User ID" },
                firstName: { type: "string", description: "User first name" },
                lastName: { type: "string", description: "User last name" },
                fullName: { type: "string", description: "Calculated full name (virtual field)" },
                phone: { type: "string", description: "User phone number" },
                email: { type: "string", format: "email", description: "User email address" },
                emailVerified: { type: "boolean", description: "Whether email is verified", default: false },
                avatar_Id: { type: "string", format: "uuid", description: "Avatar file ID" },
                lastAccess: { type: "string", format: "date-time", description: "Last access timestamp" },
                status: { type: "string", enum: ["active", "inactive", "deleted", "suspended", "pending"], description: "User status", default: "active" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                userRoles: { type: "array", items: { $ref: "#/components/schemas/baasix_UserRole" }, description: "User role assignments" },
                avatar: { $ref: "#/components/schemas/baasix_File", description: "Avatar file" }
            },
            required: ["id", "firstName"]
        },
        baasix_Account: {
            type: "object",
            description: "User authentication accounts (credential or OAuth providers)",
            properties: {
                id: { type: "string", format: "uuid", description: "Account ID" },
                user_Id: { type: "string", format: "uuid", description: "Associated user ID" },
                accountId: { type: "string", description: "Account ID from OAuth provider or same as user_Id for credential accounts" },
                providerId: { type: "string", description: "Provider ID (e.g., 'credential', 'google', 'facebook', 'github', 'apple')" },
                accessToken: { type: "string", description: "OAuth access token (sensitive, excluded from responses)" },
                refreshToken: { type: "string", description: "OAuth refresh token (sensitive, excluded from responses)" },
                accessTokenExpiresAt: { type: "string", format: "date-time", description: "Access token expiration timestamp" },
                refreshTokenExpiresAt: { type: "string", format: "date-time", description: "Refresh token expiration timestamp" },
                scope: { type: "string", description: "OAuth scope" },
                idToken: { type: "string", description: "OAuth ID token (sensitive, excluded from responses)" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                user: { $ref: "#/components/schemas/baasix_User", description: "Associated user" }
            },
            required: ["id", "user_Id", "accountId", "providerId"]
        },
        baasix_Verification: {
            type: "object",
            description: "Verification tokens for email verification, password reset, and magic links",
            properties: {
                id: { type: "string", format: "uuid", description: "Verification ID" },
                identifier: { type: "string", description: "Identifier (e.g., 'email-verification:user@example.com', 'magic-link:user@example.com')" },
                value: { type: "string", description: "Token value (sensitive, excluded from responses)" },
                expiresAt: { type: "string", format: "date-time", description: "Token expiration timestamp" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" }
            },
            required: ["id", "identifier", "value", "expiresAt"]
        },
        baasix_Sessions: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Session ID" },
                token: { type: "string", description: "Session token" },
                user_Id: { type: "string", format: "uuid", description: "User ID" },
                tenant_Id: { type: "string", format: "uuid", description: "Tenant ID" },
                expiresAt: { type: "string", format: "date-time", description: "Session expiration timestamp" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                user: { $ref: "#/components/schemas/baasix_User", description: "Associated user" },
                tenant: { $ref: "#/components/schemas/baasix_Tenant", description: "Associated tenant" }
            },
            required: ["id", "token", "user_Id", "expiresAt"]
        },
        baasix_File: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "File ID" },
                title: { type: "string", description: "File title" },
                filename: { type: "string", description: "File name on disk" },
                originalFilename: { type: "string", description: "Original filename" },
                type: { type: "string", description: "MIME type" },
                size: { type: "integer", description: "File size in bytes" },
                description: { type: "string", description: "File description" },
                storage: { type: "string", description: "Storage service used" },
                width: { type: "integer", description: "Image width (if applicable)" },
                height: { type: "integer", description: "Image height (if applicable)" },
                metadata: { type: "object", description: "File metadata" },
                userCreated_Id: { type: "string", format: "uuid", description: "User who created the file" },
                userUpdated_Id: { type: "string", format: "uuid", description: "User who last updated the file" },
                tenant_Id: { type: "string", format: "uuid", description: "Tenant ID" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                userCreated: { $ref: "#/components/schemas/baasix_User", description: "User who created the file" },
                userUpdated: { $ref: "#/components/schemas/baasix_User", description: "User who last updated the file" },
                tenant: { $ref: "#/components/schemas/baasix_Tenant", description: "Associated tenant" }
            },
            required: ["id", "filename", "originalFilename", "type", "size", "storage"]
        },
        baasix_EmailLog: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Email log ID" },
                email: { type: "string", format: "email", description: "Recipient email address" },
                subject: { type: "string", description: "Email subject" },
                templateName: { type: "string", description: "Email template name" },
                sender: { type: "string", description: "Sender email address" },
                status: { type: "string", description: "Email status" },
                messageId: { type: "string", description: "Email message ID" },
                errorMessage: { type: "string", description: "Error message if failed" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" }
            },
            required: ["id", "email", "subject"]
        },
        baasix_AuditLog: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Audit log ID" },
                type: { type: "string", description: "Log type", default: "data" },
                entity: { type: "string", description: "Entity name" },
                entityId: { type: "string", description: "Entity ID" },
                action: { type: "string", description: "Action performed" },
                changes: { type: "object", description: "Changes made" },
                ipaddress: { type: "string", description: "IP address" },
                userId: { type: "string", format: "uuid", description: "User ID" },
                tenant_Id: { type: "string", format: "uuid", description: "Tenant ID" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                user: { $ref: "#/components/schemas/baasix_User", description: "Associated user" },
                tenant: { $ref: "#/components/schemas/baasix_Tenant", description: "Associated tenant" }
            },
            required: ["id", "entity", "action"]
        },
        baasix_Notification: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Notification ID" },
                type: { type: "string", description: "Notification type" },
                title: { type: "string", description: "Notification title" },
                message: { type: "string", description: "Notification message" },
                seen: { type: "boolean", description: "Whether notification has been seen", default: false },
                data: { type: "object", description: "Additional notification data" },
                userId: { type: "string", format: "uuid", description: "User ID" },
                tenant_Id: { type: "string", format: "uuid", description: "Tenant ID" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                user: { $ref: "#/components/schemas/baasix_User", description: "Associated user" },
                tenant: { $ref: "#/components/schemas/baasix_Tenant", description: "Associated tenant" }
            },
            required: ["id", "type", "title", "userId"]
        },
        baasix_Settings: {
            type: "object",
            properties: {
                id: { type: "integer", description: "Settings ID (auto-increment)" },
                project_name: { type: "string", description: "Project name", default: "Baasix Project" },
                project_url: { type: "string", description: "Project URL" },
                project_color: { type: "string", description: "Project color" },
                project_logo_light_Id: { type: "string", format: "uuid", description: "Light logo file ID" },
                project_logo_dark_Id: { type: "string", format: "uuid", description: "Dark logo file ID" },
                project_favicon_Id: { type: "string", format: "uuid", description: "Favicon file ID" },
                project_icon_Id: { type: "string", format: "uuid", description: "Icon file ID" },
                email_icon_Id: { type: "string", format: "uuid", description: "Email icon file ID" },
                email_signature: { type: "string", description: "Email signature" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                project_logo_light: { $ref: "#/components/schemas/baasix_File", description: "Light logo file" },
                project_logo_dark: { $ref: "#/components/schemas/baasix_File", description: "Dark logo file" },
                project_favicon: { $ref: "#/components/schemas/baasix_File", description: "Favicon file" },
                project_icon: { $ref: "#/components/schemas/baasix_File", description: "Icon file" },
                email_icon: { $ref: "#/components/schemas/baasix_File", description: "Email icon file" }
            },
            required: ["id", "project_name"]
        },
        baasix_Invite: {
            type: "object",
            properties: {
                id: { type: "string", format: "uuid", description: "Invite ID" },
                email: { type: "string", format: "email", description: "Email address of the invitee" },
                role_Id: { type: "string", format: "uuid", description: "Role to assign when invitation is accepted" },
                tenant_Id: { type: "string", format: "uuid", description: "Tenant ID" },
                token: { type: "string", description: "Invitation token" },
                expiresAt: { type: "string", format: "date-time", description: "Invitation expiration" },
                invitedBy_Id: { type: "string", format: "uuid", description: "User who sent the invitation" },
                acceptedAt: { type: "string", format: "date-time", description: "When invitation was accepted" },
                status: { type: "string", enum: ["pending", "accepted", "expired", "revoked"], description: "Invitation status", default: "pending" },
                createdAt: { type: "string", format: "date-time", description: "Creation timestamp" },
                updatedAt: { type: "string", format: "date-time", description: "Update timestamp" },
                role: { $ref: "#/components/schemas/baasix_Role", description: "Associated role" },
                tenant: { $ref: "#/components/schemas/baasix_Tenant", description: "Associated tenant" },
                invitedBy: { $ref: "#/components/schemas/baasix_User", description: "User who sent the invitation" }
            },
            required: ["id", "email", "role_Id", "token", "expiresAt", "invitedBy_Id"]
        },
    };
}

// Continue with helper functions...
// (Due to character limit, I'll provide the remaining functions in the next part)

function createDetailedOperation(endpoint: EndpointInfo): any {
    const { type } = endpoint;

    if (type === "system") {
        return createSystemEndpointOperation(endpoint);
    } else if (type === "collection") {
        return createCollectionEndpointOperation(endpoint);
    } else if (type === "extension") {
        return createExtensionEndpointOperation(endpoint);
    }

    return {
        summary: endpoint.description,
        tags: [endpoint.category],
        responses: getStandardResponses()
    };
}

function createSystemEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: [category],
        responses: getStandardResponses()
    };

    // Add specific schemas for auth endpoints
    if (endpointPath.startsWith("/auth/")) {
        return createAuthEndpointOperation(endpoint);
    }

    // Add specific schemas for notification endpoints
    if (endpointPath.startsWith("/notifications")) {
        return createNotificationEndpointOperation(endpoint);
    }

    // Add specific schemas for schema management
    if (endpointPath.startsWith("/schemas")) {
        return createSchemaEndpointOperation(endpoint);
    }

    // Add specific schemas for file management
    if (endpointPath.startsWith("/files")) {
        return createFileEndpointOperation(endpoint);
    }

    // Add specific schemas for permission management
    if (endpointPath.startsWith("/permissions")) {
        return createPermissionEndpointOperation(endpoint);
    }

    // Add specific schemas for utils endpoints
    if (endpointPath.startsWith("/utils")) {
        return createUtilsEndpointOperation(endpoint);
    }

    // Add specific schemas for realtime endpoints
    if (endpointPath.startsWith("/realtime")) {
        return createRealtimeEndpointOperation(endpoint);
    }

    // Add parameters for endpoints with path parameters
    if (endpointPath.includes("{id}")) {
        operation.parameters = [{
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Resource ID"
        }];
    }

    if (endpointPath.includes("{collectionName}")) {
        operation.parameters = operation.parameters || [];
        operation.parameters.push({
            name: "collectionName",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Collection name"
        });
    }

    // Add request body for POST, PUT, PATCH methods
    if (["post", "put", "patch"].includes(methodLower)) {
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { type: "object" }
                }
            }
        };
    }

    return operation;
}

// Due to length constraints, I'll create a second file with the remaining helper functions
// Let me write the continuation...

function createAuthEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: [category],
        responses: getStandardResponses()
    };

    // Specific auth endpoint configurations
    if (endpointPath === "/auth/register" && methodLower === "post") {
        operation.description = "Register a new user account. Supports both public registration and invite-based registration.";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/RegisterRequest" }
                }
            }
        };
        operation.responses["201"] = {
            description: "User registered successfully",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/AuthResponse" }
                }
            }
        };
    } else if (endpointPath === "/auth/login" && methodLower === "post") {
        operation.description = "Authenticate user and return access token. Supports JWT and cookie-based authentication.";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/LoginRequest" }
                }
            }
        };
        operation.responses["200"] = {
            description: "Login successful",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/AuthResponse" }
                }
            }
        };
    } else if (endpointPath === "/auth/me" && methodLower === "get") {
        operation.description = "Get current user information";
        operation.responses["200"] = {
            description: "Current user information",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: { $ref: "#/components/schemas/baasix_User" }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/auth/invite" && methodLower === "post") {
        operation.description = "Send invitation to a user";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/InviteRequest" }
                }
            }
        };
    } else if (endpointPath === "/auth/switch-tenant" && methodLower === "post") {
        operation.description = "Switch to different tenant";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/SwitchTenantRequest" }
                }
            }
        };
    } else if (endpointPath === "/auth/magiclink" && methodLower === "post") {
        operation.description = "Send magic link for passwordless login";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/MagicLinkRequest" }
                }
            }
        };
    } else if (endpointPath.includes("{token}")) {
        operation.parameters = [{
            name: "token",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Token parameter"
        }];
    }

    return operation;
}

function createNotificationEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: [category],
        responses: getStandardResponses()
    };

    if (endpointPath === "/notifications" && methodLower === "get") {
        operation.description = "Get user notifications with pagination and filtering";
        operation.responses["200"] = {
            description: "List of notifications",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/NotificationListResponse" }
                }
            }
        };
        operation.parameters = [
            {
                name: "filter",
                in: "query",
                schema: { type: "string" },
                description: "JSON filter object for notifications"
            },
            {
                name: "sort",
                in: "query",
                schema: { type: "string" },
                description: "Sorting criteria"
            },
            {
                name: "limit",
                in: "query",
                schema: { type: "integer", default: 100 },
                description: "Number of notifications per page"
            },
            {
                name: "page",
                in: "query",
                schema: { type: "integer", default: 1 },
                description: "Page number"
            }
        ];
    } else if (endpointPath === "/notifications/unread/count" && methodLower === "get") {
        operation.description = "Get count of unread notifications";
        operation.responses["200"] = {
            description: "Unread notifications count",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/NotificationCountResponse" }
                }
            }
        };
    } else if (endpointPath === "/notifications/mark-seen" && methodLower === "post") {
        operation.description = "Mark notifications as seen";
        operation.requestBody = {
            required: false,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            notificationIds: {
                                type: "array",
                                items: { type: "string", format: "uuid" },
                                description: "Optional array of specific notification IDs to mark as seen"
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/notifications" && methodLower === "delete") {
        operation.description = "Delete notifications";
        operation.requestBody = {
            required: false,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            notificationIds: {
                                type: "array",
                                items: { type: "string", format: "uuid" },
                                description: "Optional array of specific notification IDs to delete"
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/notifications/send" && methodLower === "post") {
        operation.description = "Send notifications to users (admin only)";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            type: { type: "string", description: "Notification type" },
                            title: { type: "string", description: "Notification title" },
                            message: { type: "string", description: "Notification message" },
                            userIds: {
                                type: "array",
                                items: { type: "string", format: "uuid" },
                                description: "Array of user IDs to notify"
                            },
                            data: { type: "object", description: "Additional notification data" }
                        },
                        required: ["type", "title", "message", "userIds"]
                    }
                }
            }
        };
    }

    return operation;
}

function createFileEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: [category],
        responses: getStandardResponses()
    };

    if (endpointPath === "/files" && methodLower === "get") {
        operation.description = "Get all files with pagination and filtering";
        operation.responses["200"] = {
            description: "List of files",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "array",
                                items: { $ref: "#/components/schemas/baasix_File" }
                            },
                            totalCount: { type: "integer" }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/files" && methodLower === "post") {
        operation.description = "Upload a file to the server. Supports multiple storage providers.";
        operation.requestBody = {
            required: true,
            content: {
                "multipart/form-data": {
                    schema: {
                        type: "object",
                        properties: {
                            file: { type: "string", format: "binary", description: "File to upload" },
                            title: { type: "string", description: "Optional file title" },
                            storage: { type: "string", description: "Storage service to use" }
                        },
                        required: ["file"]
                    }
                }
            }
        };
        operation.responses["200"] = {
            description: "File uploaded successfully",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/FileUploadResponse" }
                }
            }
        };
    } else if (endpointPath === "/files/upload-from-url" && methodLower === "post") {
        operation.description = "Upload a file from a URL";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            url: { type: "string", format: "uri", description: "URL of file to upload" },
                            title: { type: "string", description: "Optional file title" },
                            storage: { type: "string", description: "Storage service to use" }
                        },
                        required: ["url"]
                    }
                }
            }
        };
    } else if (endpointPath.includes("{id}")) {
        operation.parameters = [{
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "File ID"
        }];

        if (methodLower === "get") {
            operation.responses["200"] = {
                description: "File details",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                data: { $ref: "#/components/schemas/baasix_File" }
                            }
                        }
                    }
                }
            };
        } else if (methodLower === "patch") {
            operation.description = "Update file metadata or replace file content";
            operation.requestBody = {
                required: false,
                content: {
                    "multipart/form-data": {
                        schema: {
                            type: "object",
                            properties: {
                                file: { type: "string", format: "binary", description: "New file content (optional)" },
                                title: { type: "string", description: "Updated file title" }
                            }
                        }
                    }
                }
            };
        }
    }

    return operation;
}

function createSchemaEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: [category],
        responses: getStandardResponses()
    };

    if (endpointPath === "/schemas" && methodLower === "get") {
        operation.description = "Retrieve all available schemas/collections in the system.";
        operation.responses["200"] = {
            description: "List of schemas",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "array",
                                items: { $ref: "#/components/schemas/Schema" }
                            },
                            totalCount: { type: "integer" }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/schemas" && methodLower === "post") {
        operation.description = "Create a new schema/collection";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            collectionName: { type: "string", description: "Name of the collection" },
                            schema: { $ref: "#/components/schemas/Schema/properties/schema" }
                        },
                        required: ["collectionName", "schema"]
                    }
                }
            }
        };
    } else if (endpointPath.includes("{collectionName}")) {
        operation.parameters = [{
            name: "collectionName",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Name of the collection/schema"
        }];

        if (methodLower === "get") {
            operation.description = "Get detailed schema definition for a specific collection.";
            operation.responses["200"] = {
                description: "Schema details",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                data: { $ref: "#/components/schemas/Schema" }
                            }
                        }
                    }
                }
            };
        }
    }

    return operation;
}

function createExtensionEndpointOperation(endpoint: EndpointInfo): any {
    return {
        summary: endpoint.description,
        description: "Custom endpoint provided by an extension. Refer to extension documentation for detailed parameters and responses.",
        tags: [endpoint.category],
        responses: getStandardResponses()
    };
}

function createPermissionEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: [category],
        responses: getStandardResponses()
    };

    if (endpointPath === "/permissions" && methodLower === "get") {
        operation.description = "Get permissions with pagination and filtering";
        operation.responses["200"] = {
            description: "List of permissions",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "array",
                                items: { $ref: "#/components/schemas/baasix_Permission" }
                            },
                            totalCount: { type: "integer" }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/permissions" && methodLower === "post") {
        operation.description = "Create new permission";
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            action: { type: "string", description: "Action (create, read, update, delete, etc.)" },
                            collection: { type: "string", description: "Collection name" },
                            role_Id: { type: "string", format: "uuid", description: "Role ID" },
                            fields: { type: "object", description: "Field-level permissions" },
                            conditions: { type: "object", description: "Access conditions" }
                        },
                        required: ["action", "collection", "role_Id"]
                    }
                }
            }
        };
    } else if (endpointPath.includes("{id}")) {
        operation.parameters = [{
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Permission ID"
        }];

        if (methodLower === "get") {
            operation.responses["200"] = {
                description: "Permission details",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                data: { $ref: "#/components/schemas/baasix_Permission" }
                            }
                        }
                    }
                }
            };
        }
    }

    return operation;
}

function createUtilsEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: [category],
        responses: getStandardResponses()
    };

    if (endpointPath === "/utils/sort/{collection}" && methodLower === "post") {
        operation.description = "Sort items within a collection by moving an item before/after another item";
        operation.parameters = [{
            name: "collection",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Collection name to sort items in"
        }];
        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            item: { type: "string", description: "ID of item to move" },
                            to: { type: "string", description: "ID of target item to move relative to" }
                        },
                        required: ["item", "to"]
                    }
                }
            }
        };
    }

    return operation;
}

function createCollectionEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, collectionName } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        description: getCollectionEndpointDescription(endpointPath, methodLower, collectionName!),
        tags: ["data"],
        responses: getStandardResponses()
    };

    if (methodLower === "get" && !endpointPath.includes("{id}")) {
        // List endpoint
        operation.responses["200"] = {
            description: "List of items with pagination",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "array",
                                items: { $ref: `#/components/schemas/${collectionName}` },
                                description: `Array of ${collectionName} items`
                            },
                            totalCount: {
                                type: "integer",
                                description: "Total number of items available"
                            },
                            page: {
                                type: "integer",
                                description: "Current page number (1-based)"
                            },
                            limit: {
                                type: "integer",
                                description: "Number of items per page"
                            }
                        },
                        required: ["data"]
                    }
                }
            }
        };

        // Add comprehensive query parameters
        operation.parameters = [
            {
                name: "fields",
                in: "query",
                schema: { type: "string" },
                description: "Comma-separated list of fields to return. Use dot notation for nested/relational fields (e.g., 'name,email,category.name,user.profile.avatar')"
            },
            {
                name: "filter",
                in: "query",
                schema: { type: "string" },
                description: "JSON filter object. Supports operators: eq, ne, lt, lte, gt, gte, in, notIn, like, startsWith, endsWith, isNull, isNotNull, between, etc. Use fieldName or $fieldName$ syntax for fields (both supported) and relationName.fieldName for relational fields. Supports AND/OR logic. Examples: {\"name\":{\"eq\":\"test\"}} or {\"AND\":[{\"age\":{\"gte\":18}},{\"user.status\":{\"eq\":\"active\"}}]}"
            },
            {
                name: "sort",
                in: "query",
                schema: { type: "string" },
                description: "JSON array of sort objects. Each object specifies field and direction. Supports relational field sorting. Examples: [{\"name\":\"asc\"}] or [{\"createdAt\":\"desc\"},{\"user.name\":\"asc\"}] or [{\"category.name\":\"asc\",\"price\":\"desc\"}]"
            },
            {
                name: "limit",
                in: "query",
                schema: {
                    type: "integer",
                    minimum: -1,
                    maximum: 1000,
                    default: 100
                },
                description: "Number of items to return per page. Set to -1 to get all data without pagination (max 1000 for safety, default 100)"
            },
            {
                name: "page",
                in: "query",
                schema: {
                    type: "integer",
                    minimum: 1,
                    default: 1
                },
                description: "Page number for pagination (1-based, default 1). Only used when limit is not -1"
            },
            {
                name: "search",
                in: "query",
                schema: { type: "string" },
                description: "Full-text search term. Searches across searchable fields in the collection."
            },
            {
                name: "searchFields",
                in: "query",
                schema: { type: "string" },
                description: "Comma-separated list of fields to search in. Only applies when 'search' parameter is used."
            },
            {
                name: "relConditions",
                in: "query",
                schema: { type: "string" },
                description: "JSON object for filtering related/nested data separately from main filter. Allows filtering on relationships after they're loaded. Field names can use either plain or $field$ syntax (both supported). Example: {\"relationName\":{\"field\":{\"eq\":\"value\"}},\"nestedRelation\":{\"field\":{\"gt\":100}}}"
            },
            {
                name: "aggregate",
                in: "query",
                schema: { type: "string" },
                description: "JSON object for aggregation operations. Example: {\"count\":\"*\",\"avg\":\"age\",\"sum\":\"amount\"}"
            },
            {
                name: "groupBy",
                in: "query",
                schema: { type: "string" },
                description: "Comma-separated list of fields to group by. Used with aggregate functions."
            }
        ];
    } else if (methodLower === "get" && endpointPath.includes("{id}")) {
        // Single item endpoint
        operation.responses["200"] = {
            description: "Single item details",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                $ref: `#/components/schemas/${collectionName}`,
                                description: `${collectionName} item details`
                            }
                        },
                        required: ["data"]
                    }
                }
            }
        };

        operation.parameters = [
            {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
                description: "Unique identifier of the item"
            },
            {
                name: "fields",
                in: "query",
                schema: { type: "string" },
                description: "Comma-separated list of fields to return. Use dot notation for nested/relational fields (e.g., 'name,email,category.name,user.profile.avatar')"
            }
        ];
    } else if (methodLower === "post") {
        // Create endpoint
        operation.responses["201"] = {
            description: "Item created successfully",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                $ref: `#/components/schemas/${collectionName}`,
                                description: `Created ${collectionName} item`
                            }
                        },
                        required: ["data"]
                    }
                }
            }
        };

        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: `#/components/schemas/${collectionName}CreateRequest` }
                }
            }
        };
    } else if (["put", "patch"].includes(methodLower)) {
        // Update endpoints
        operation.responses["200"] = {
            description: "Item updated successfully",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                $ref: `#/components/schemas/${collectionName}`,
                                description: `Updated ${collectionName} item`
                            }
                        },
                        required: ["data"]
                    }
                }
            }
        };

        operation.parameters = [{
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Unique identifier of the item to update"
        }];

        operation.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        $ref: methodLower === "put" ?
                            `#/components/schemas/${collectionName}UpdateRequest` :
                            `#/components/schemas/${collectionName}PatchRequest`
                    }
                }
            }
        };
    } else if (methodLower === "delete") {
        // Delete endpoint
        operation.responses["204"] = {
            description: "Item deleted successfully"
        };

        operation.parameters = [{
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Unique identifier of the item to delete"
        }];
    }

    return operation;
}

// Helper function to convert Baasix field types to OpenAPI types
function convertBaasixTypeToOpenApi(baasixType: string, field: any) {
    const typeMap: any = {
        'String': { type: 'string' },
        'Text': { type: 'string' },
        'Integer': { type: 'integer', format: 'int32' },
        'Double': { type: 'number', format: 'double' },
        'Boolean': { type: 'boolean' },
        'UUID': { type: 'string', format: 'uuid' },
        'Date': { type: 'string', format: 'date-time' },
        'JSON': { type: 'object' },
        'ENUM': { type: 'string', enum: field.values || [] }
    };

    const openApiType = typeMap[baasixType] || { type: 'string' };

    if (field.defaultValue !== undefined) {
        openApiType.default = field.defaultValue;
    }

    if (baasixType === 'String' && field.length) {
        openApiType.maxLength = field.length;
    }

    return openApiType;
}

// Generate dynamic schemas for collections
function generateCollectionSchemas(endpoints: EndpointInfo[]) {
    const collectionSchemas: any = {};

    for (const endpoint of endpoints) {
        if (endpoint.type === 'collection' && endpoint.schema) {
            const { collectionName, schema } = endpoint;

            if (!collectionSchemas[collectionName!]) {
                const schemaDefinition = generateSchemaDefinition(schema, collectionName!);
                collectionSchemas[collectionName!] = schemaDefinition.item;
                collectionSchemas[`${collectionName}CreateRequest`] = schemaDefinition.createRequest;
                collectionSchemas[`${collectionName}UpdateRequest`] = schemaDefinition.updateRequest;
                collectionSchemas[`${collectionName}PatchRequest`] = schemaDefinition.patchRequest;
            }
        }
    }

    return collectionSchemas;
}

function generateSchemaDefinition(schema: any, collectionName: string) {
    const properties: any = {};
    const required: string[] = [];
    const createRequired: string[] = [];
    const relationships: any = {};

    // Process fields
    if (schema.fields) {
        for (const [fieldName, fieldDef] of Object.entries(schema.fields) as [string, any][]) {
            // Skip system generated fields and relationships for create requests
            const isSystemGenerated = fieldDef.SystemGenerated === true || fieldDef.SystemGenerated === "true";
            const isRelationship = fieldDef.relType;

            if (isRelationship) {
                // Handle relationships with proper schema references
                const targetCollection = fieldDef.target;

                let schemaRef: any;
                if (targetCollection.startsWith('baasix_')) {
                    // System collection - create a simplified reference
                    schemaRef = {
                        type: 'object',
                        description: `${fieldDef.relType} relationship to ${targetCollection}`,
                        readOnly: true
                    };
                } else {
                    // User collection - reference the schema if it exists
                    if (fieldDef.relType === 'HasMany' || fieldDef.relType === 'BelongsToMany') {
                        schemaRef = {
                            type: 'array',
                            items: { $ref: `#/components/schemas/${targetCollection}` },
                            description: `${fieldDef.relType} relationship to ${targetCollection}`,
                            readOnly: true
                        };
                    } else {
                        schemaRef = {
                            $ref: `#/components/schemas/${targetCollection}`,
                            description: `${fieldDef.relType} relationship to ${targetCollection}`,
                            readOnly: true
                        };
                    }
                }

                relationships[fieldName] = schemaRef;
                continue;
            }

            const openApiField = convertBaasixTypeToOpenApi(fieldDef.type, fieldDef);

            // Add description
            if (fieldDef.description) {
                openApiField.description = fieldDef.description;
            } else {
                openApiField.description = `${fieldName} field`;
            }

            // Add to properties
            properties[fieldName] = openApiField;

            // Handle required fields
            if (fieldDef.allowNull === false && !isSystemGenerated) {
                required.push(fieldName);
                if (!fieldDef.primaryKey && !fieldDef.defaultValue) {
                    createRequired.push(fieldName);
                }
            }
        }
    }

    // Add timestamps if enabled
    if (schema.timestamps) {
        properties.createdAt = {
            type: 'string',
            format: 'date-time',
            description: 'Record creation timestamp',
            readOnly: true
        };
        properties.updatedAt = {
            type: 'string',
            format: 'date-time',
            description: 'Record last update timestamp',
            readOnly: true
        };
    }

    // Create the main item schema (for responses)
    const itemSchema: any = {
        type: 'object',
        properties: {
            ...properties,
            ...relationships
        }
    };

    if (required.length > 0) {
        itemSchema.required = required;
    }

    // Create request schemas (without read-only fields)
    const createProperties: any = {};
    const updateProperties: any = {};
    
    for (const [fieldName, fieldDef] of Object.entries(properties)) {
        const fd = fieldDef as any;
        if (!fd.readOnly) {
            // Only spread when the field definition is an object; otherwise assign directly
            if (fd && typeof fd === "object") {
                createProperties[fieldName] = { ...fd };
                updateProperties[fieldName] = { ...fd };
            } else {
                createProperties[fieldName] = fd;
                updateProperties[fieldName] = fd;
            }
        }
    }
    
    const createRequestSchema: any = {
        type: 'object',
        properties: createProperties,
        description: `Data for creating a new ${collectionName} item`
    };

    if (createRequired.length > 0) {
        createRequestSchema.required = createRequired;
    }

    const updateRequestSchema = {
        type: 'object',
        properties: updateProperties,
        description: `Complete data for updating a ${collectionName} item (all fields will be replaced)`
    };

    const patchRequestSchema = {
        type: 'object',
        properties: updateProperties,
        description: `Partial data for updating a ${collectionName} item (only provided fields will be updated)`
    };

    return {
        item: itemSchema,
        createRequest: createRequestSchema,
        updateRequest: updateRequestSchema,
        patchRequest: patchRequestSchema
    };
}

// Helper function to get standard responses
function getStandardResponses() {
    return {
        "400": {
            description: "Bad Request - Invalid input parameters",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                            message: { type: "string" }
                        }
                    }
                }
            }
        },
        "401": {
            description: "Unauthorized - Authentication required",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                            message: { type: "string" }
                        }
                    }
                }
            }
        },
        "403": {
            description: "Forbidden - Insufficient permissions",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                            message: { type: "string" }
                        }
                    }
                }
            }
        },
        "404": {
            description: "Not Found - Resource does not exist",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                            message: { type: "string" }
                        }
                    }
                }
            }
        },
        "500": {
            description: "Internal Server Error",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            error: { type: "string" },
                            message: { type: "string" }
                        }
                    }
                }
            }
        }
    };
}

// Helper function to get collection endpoint descriptions
function getCollectionEndpointDescription(path: string, method: string, collectionName: string) {
    const methodDescriptions: any = {
        "get": path.includes("/{id}")
            ? `Get a specific ${collectionName} item by ID`
            : `Get list of ${collectionName} items with optional filtering, sorting, and pagination`,
        "post": `Create a new ${collectionName} item`,
        "put": `Update a ${collectionName} item (replace all fields)`,
        "patch": `Partially update a ${collectionName} item (update only provided fields)`,
        "delete": `Delete a ${collectionName} item by ID`
    };

    return methodDescriptions[method] || `${method.toUpperCase()} operation for ${collectionName}`;
}

function createRealtimeEndpointOperation(endpoint: EndpointInfo): any {
    const { path: endpointPath, method, description, category } = endpoint;
    const methodLower = method.toLowerCase();

    const operation: any = {
        summary: description,
        tags: ["realtime"],
        security: [{ bearerAuth: [] }],
        responses: getStandardResponses()
    };

    if (endpointPath === "/realtime/status" && methodLower === "get") {
        operation.description = "Get the current status of the realtime WAL service including replication configuration";
        operation.responses["200"] = {
            description: "Realtime service status",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "object",
                                properties: {
                                    initialized: { type: "boolean", description: "Whether the service is initialized" },
                                    connected: { type: "boolean", description: "Whether connected to PostgreSQL replication" },
                                    enabledCollections: { 
                                        type: "array", 
                                        items: { type: "string" },
                                        description: "List of collections with realtime enabled"
                                    },
                                    publicationName: { type: "string", description: "PostgreSQL publication name" },
                                    slotName: { type: "string", description: "PostgreSQL replication slot name" },
                                    walEnabled: { type: "boolean", description: "Whether WAL-based realtime is enabled" },
                                    replicationConfig: {
                                        type: "object",
                                        properties: {
                                            walLevel: { type: "string" },
                                            maxReplicationSlots: { type: "integer" },
                                            maxWalSenders: { type: "integer" },
                                            isConfigured: { type: "boolean" },
                                            issues: { type: "array", items: { type: "string" } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/realtime/config" && methodLower === "get") {
        operation.description = "Check PostgreSQL logical replication configuration requirements";
        operation.responses["200"] = {
            description: "PostgreSQL replication configuration",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "object",
                                properties: {
                                    walLevel: { type: "string", description: "Current wal_level setting" },
                                    maxReplicationSlots: { type: "integer", description: "Maximum replication slots" },
                                    maxWalSenders: { type: "integer", description: "Maximum WAL senders" },
                                    isConfigured: { type: "boolean", description: "Whether all requirements are met" },
                                    issues: { 
                                        type: "array", 
                                        items: { type: "string" },
                                        description: "Configuration issues if any"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/realtime/collections" && methodLower === "get") {
        operation.description = "Get list of all collections that have realtime enabled";
        operation.responses["200"] = {
            description: "List of realtime-enabled collections",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "array",
                                items: { type: "string" },
                                description: "Collection names with realtime enabled"
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/realtime/collections/{collection}" && methodLower === "get") {
        operation.description = "Check if a specific collection has realtime enabled";
        operation.parameters = [{
            name: "collection",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Collection name"
        }];
        operation.responses["200"] = {
            description: "Collection realtime status",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "object",
                                properties: {
                                    collection: { type: "string" },
                                    enabled: { type: "boolean" }
                                }
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/realtime/collections/{collection}/enable" && methodLower === "post") {
        operation.description = "Enable realtime for a collection. This adds the table to the PostgreSQL publication and starts streaming changes.";
        operation.parameters = [{
            name: "collection",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Collection name to enable realtime for"
        }];
        operation.requestBody = {
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            replicaIdentityFull: { 
                                type: "boolean", 
                                default: false,
                                description: "Set REPLICA IDENTITY FULL to include old values on UPDATE/DELETE (requires table lock)"
                            }
                        }
                    }
                }
            }
        };
        operation.responses["200"] = {
            description: "Realtime enabled successfully",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "object",
                                properties: {
                                    message: { type: "string" },
                                    collection: { type: "string" },
                                    replicaIdentityFull: { type: "boolean" }
                                }
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/realtime/collections/{collection}/disable" && methodLower === "post") {
        operation.description = "Disable realtime for a collection. This removes the table from the PostgreSQL publication.";
        operation.parameters = [{
            name: "collection",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Collection name to disable realtime for"
        }];
        operation.responses["200"] = {
            description: "Realtime disabled successfully",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "object",
                                properties: {
                                    message: { type: "string" },
                                    collection: { type: "string" }
                                }
                            }
                        }
                    }
                }
            }
        };
    } else if (endpointPath === "/realtime/initialize" && methodLower === "post") {
        operation.description = "Manually initialize the realtime service if it was not auto-started";
        operation.responses["200"] = {
            description: "Realtime service initialized",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "object",
                                properties: {
                                    message: { type: "string" },
                                    status: { type: "object" }
                                }
                            }
                        }
                    }
                }
            }
        };
    }

    return operation;
}

export default {
    id: "openapi",
    handler: registerEndpoint,
};
