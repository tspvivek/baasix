import env from "../utils/env.js";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { getUserRolesPermissionsAndTenant } from "../utils/auth.js";
import { permissionService } from "./PermissionService.js";
import settingsService from "./SettingsService.js";
import { APIError } from "../utils/errorHandler.js";
import type { Server as HTTPServer } from "http";
import type { Socket } from "socket.io";
import type { UserInfo, SocketWithAuth } from '../types/index.js';

class SocketService {
  private io: Server | null = null;
  private userSockets: Map<string | number, Set<Socket>> = new Map();
  private initialized: boolean = false;
  private redisPublisher: Redis | null = null;
  private redisSubscriber: Redis | null = null;

  constructor() {
    console.info("Socket Service instance created");
  }

  async initialize(server: HTTPServer): Promise<void> {
    if (this.initialized) {
      console.warn("Socket.IO service already initialized");
      return;
    }

    // Get dynamic CORS origins for socket
    const getSocketCorsOrigins = async (): Promise<string | string[]> => {
      try {
        const staticOrigins = env.get("SOCKET_CORS_ENABLED_ORIGINS")?.split(",").map(o => o.trim()) || [];
        const dynamicOrigins = await settingsService.getAllSettingsUrls();
        const allOrigins = [...new Set([...staticOrigins, ...dynamicOrigins])];
        console.info(`Socket CORS origins: ${allOrigins.length} total (${staticOrigins.length} static + ${dynamicOrigins.length} dynamic)`);
        return allOrigins.length > 0 ? allOrigins : "*";
      } catch (error) {
        console.error("Error getting socket CORS origins:", error);
        return env.get("SOCKET_CORS_ENABLED_ORIGINS")?.split(",") || "*";
      }
    };

    this.io = new Server(server, {
      cors: {
        origin: await getSocketCorsOrigins(),
        methods: ["GET", "POST", "PATCH", "DELETE"],
        credentials: true,
      },
      path: env.get("SOCKET_PATH") || "/socket",
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Initialize Redis adapter if enabled
    if (env.get("SOCKET_REDIS_ENABLED") === "true") {
      await this.initializeRedisAdapter();
    }

    // Authentication middleware
    this.io.use(this.authMiddleware.bind(this));

    this.io.on("connection", this.handleConnection.bind(this));
    this.initialized = true;
    console.info(
      "Socket.IO server initialized",
      env.get("SOCKET_REDIS_ENABLED") === "true" ? "with Redis adapter" : "with in-memory adapter"
    );
  }

  async initializeRedisAdapter(): Promise<void> {
    try {
      const redisUrl = env.get("SOCKET_REDIS_URL");
      if (!redisUrl) {
        throw new Error("SOCKET_REDIS_URL is required when Redis adapter is enabled");
      }

      // Create Redis clients for pub/sub
      this.redisPublisher = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.redisSubscriber = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      // Handle Redis connection errors
      this.redisPublisher.on("error", (error) => {
        console.error("Redis Publisher Error:", error);
      });

      this.redisSubscriber.on("error", (error) => {
        console.error("Redis Subscriber Error:", error);
      });

      // Create and set up Redis adapter
      const adapter = createAdapter(this.redisPublisher, this.redisSubscriber, {
        key: env.get("SOCKET_REDIS_KEY") || "socket.io",
        publishOnSpecificResponseChannel: true,
      });

      this.io!.adapter(adapter);

      console.info("Redis adapter initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Redis adapter:", error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.redisPublisher) {
      await this.redisPublisher.quit();
    }
    if (this.redisSubscriber) {
      await this.redisSubscriber.quit();
    }
    if (this.io) {
      await new Promise<void>((resolve) => this.io!.close(() => resolve()));
    }
    this.initialized = false;
  }

  async authMiddleware(socket: SocketWithAuth, next: (err?: Error) => void): Promise<void> {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        throw new APIError("No authentication token provided", 401);
      }

      const decoded: any = jwt.verify(token as string, env.get("SECRET_KEY")!);
      const { user, role, permissions, tenant } = await this.authenticateUser(decoded);

      // Attach user info to socket
      socket.userId = user.id;
      socket.userRole = role;
      socket.userPermissions = permissions;
      socket.userTenant = tenant;

      next();
    } catch (error: any) {
      next(new Error(error.message));
    }
  }

  async authenticateUser(decoded: any): Promise<UserInfo> {
    const { role, permissions, tenant } = await getUserRolesPermissionsAndTenant(decoded.id, decoded.tenant_Id);

    return {
      user: { id: decoded.id },
      role,
      permissions,
      tenant,
    };
  }

  async handleConnection(socket: SocketWithAuth): Promise<void> {
    try {
      // Add to userSockets map
      if (!this.userSockets.has(socket.userId!)) {
        this.userSockets.set(socket.userId!, new Set());
      }
      this.userSockets.get(socket.userId!)!.add(socket);

      // Join tenant room if applicable
      if (socket.userTenant) {
        socket.join(`tenant:${socket.userTenant.id}`);
      }

      // Handle collection subscriptions
      socket.on("subscribe", async (data: any, callback?: (response: any) => void) => {
        try {
          await this.handleSubscribe(socket, data);
          console.log(`User ${socket.userId} subscribed to ${data.collection}`);
          callback?.({ status: "success" });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle unsubscribe
      socket.on("unsubscribe", (data: any, callback?: (response: any) => void) => {
        try {
          this.handleUnsubscribe(socket, data);
          callback?.({ status: "success" });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle workflow execution room joins
      socket.on("workflow:execution:join", ({ executionId }: { executionId: string | number }) => {
        socket.join(`execution:${executionId}`);
        console.log(`User ${socket.userId} joined execution room: ${executionId}`);
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });

      // Send initial connection success
      socket.emit("connected", {
        userId: socket.userId,
        tenant: socket.userTenant,
      });
    } catch (error) {
      console.error("Socket connection error:", error);
      socket.disconnect(true);
    }
  }

  async handleSubscribe(socket: SocketWithAuth, { collection }: { collection: string }): Promise<void> {
    if (socket.userRole.name !== "administrator") {
      // Check permission
      const hasAccess = await this.checkCollectionAccess(socket, collection);
      if (!hasAccess) {
        throw new APIError("No permission to subscribe to this collection", 403);
      }
    }

    // Join the collection room
    const roomName = this.getCollectionRoom(collection, socket.userTenant?.id);
    socket.join(roomName);

    // Join specific tenant room for this collection if applicable
    if (socket.userTenant) {
      socket.join(`${roomName}:tenant:${socket.userTenant.id}`);
    }
  }

  handleUnsubscribe(socket: SocketWithAuth, { collection }: { collection: string }): void {
    const roomName = this.getCollectionRoom(collection, socket.userTenant?.id);
    socket.leave(roomName);

    if (socket.userTenant) {
      socket.leave(`${roomName}:tenant:${socket.userTenant.id}`);
    }
  }

  handleDisconnect(socket: SocketWithAuth): void {
    if (socket.userId && this.userSockets.has(socket.userId)) {
      this.userSockets.get(socket.userId)!.delete(socket);
      if (this.userSockets.get(socket.userId)!.size === 0) {
        this.userSockets.delete(socket.userId);
      }
    }
  }

  async checkCollectionAccess(socket: SocketWithAuth, collection: string): Promise<boolean> {
    return await permissionService.canAccess(socket.userRole.id, collection, "read");
  }

  getCollectionRoom(collection: string, tenantId?: string | number): string {
    return `collection:${collection}${tenantId ? `:tenant:${tenantId}` : ""}`;
  }

  broadcastChange(collection: string, action: string, data: any, accountability?: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    const excludeUserId = accountability?.user?.id;
    const tenantId = accountability?.tenant;

    // Prepare the event name and data
    const event = `${collection}:${action}`;
    const payload = {
      action,
      collection,
      data,
      timestamp: new Date().toISOString(),
    };

    // Broadcast to the collection room
    const roomName = this.getCollectionRoom(collection, tenantId);

    console.log(`Broadcasting ${event} to ${roomName}`);

    if (tenantId) {
      // In multi-tenant mode, only broadcast to the specific tenant
      this.io.to(`${roomName}:tenant:${tenantId}`).emit(event, payload);
    } else {
      // Broadcast to all subscribers
      this.io.to(roomName).emit(event, payload);
    }
  }

  /**
   * Emit workflow execution updates to connected clients
   */
  emitWorkflowExecutionUpdate(executionId: string | number, data: any): void {
    if (!this.initialized || !this.io) {
      console.log("⚠️ Socket not initialized, cannot emit workflow execution update");
      return;
    }

    const payload = {
      executionId,
      ...data,
      timestamp: new Date().toISOString(),
    };

    console.log(`📡 Emitting workflow:execution:update to room execution:${executionId}`, payload);
    this.io.to(`execution:${executionId}`).emit("workflow:execution:update", payload);
  }

  /**
   * Emit workflow execution completion
   */
  emitWorkflowExecutionComplete(executionId: string | number, data: any): void {
    if (!this.initialized || !this.io) {
      return;
    }

    this.io.to(`execution:${executionId}`).emit("workflow:execution:complete", {
      executionId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  getStats(): any {
    if (!this.initialized || !this.io) {
      return {
        status: "not initialized",
        totalConnections: 0,
        uniqueUsers: 0,
      };
    }

    return {
      status: env.get("SOCKET_REDIS_ENABLED") === "true" ? "redis" : "in-memory",
      totalConnections: this.io.engine.clientsCount,
      uniqueUsers: this.userSockets.size,
      rooms: this.io.sockets.adapter.rooms,
    };
  }
}

const socketService = new SocketService();
export default socketService;
