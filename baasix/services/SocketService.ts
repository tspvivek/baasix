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

// Type for custom message handler callback
export type CustomMessageHandler = (
  socket: SocketWithAuth,
  data: any,
  callback?: (response: any) => void
) => void | Promise<void>;

// Type for room join/leave validator
export type RoomValidator = (
  socket: SocketWithAuth,
  roomName: string
) => boolean | Promise<boolean>;

class SocketService {
  private io: Server | null = null;
  private userSockets: Map<string | number, Set<Socket>> = new Map();
  private initialized: boolean = false;
  private redisPublisher: Redis | null = null;
  private redisSubscriber: Redis | null = null;
  
  // Custom room management
  private customRooms: Map<string, Set<string>> = new Map(); // roomName -> Set of socket IDs
  private customMessageHandlers: Map<string, CustomMessageHandler> = new Map();
  private roomValidators: Map<string, RoomValidator> = new Map();

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
      path: env.get("SOCKET_PATH") || "/realtime",
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

      // Handle custom room join
      socket.on("room:join", async (data: { room: string }, callback?: (response: any) => void) => {
        try {
          await this.handleRoomJoin(socket, data.room);
          callback?.({ status: "success", room: data.room });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle custom room leave
      socket.on("room:leave", (data: { room: string }, callback?: (response: any) => void) => {
        try {
          this.handleRoomLeave(socket, data.room);
          callback?.({ status: "success", room: data.room });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle custom room message (client -> server -> room)
      socket.on("room:message", async (data: { room: string; event: string; payload: any }, callback?: (response: any) => void) => {
        try {
          await this.handleRoomMessage(socket, data.room, data.event, data.payload);
          callback?.({ status: "success" });
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
      });

      // Handle custom events with registered handlers
      socket.on("custom", async (data: { event: string; payload: any }, callback?: (response: any) => void) => {
        try {
          await this.handleCustomEvent(socket, data.event, data.payload, callback);
        } catch (error: any) {
          callback?.({ status: "error", message: error.message });
        }
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
    
    // Clean up custom room memberships
    for (const [roomName, members] of this.customRooms.entries()) {
      if (members.has(socket.id)) {
        members.delete(socket.id);
        // Emit leave event to room
        this.io?.to(`room:${roomName}`).emit("room:user:left", {
          room: roomName,
          userId: socket.userId,
          socketId: socket.id,
          timestamp: new Date().toISOString(),
        });
        // Clean up empty rooms
        if (members.size === 0) {
          this.customRooms.delete(roomName);
        }
      }
    }
  }

  // ==========================================
  // Custom Room Management
  // ==========================================

  /**
   * Handle a user joining a custom room
   */
  async handleRoomJoin(socket: SocketWithAuth, roomName: string): Promise<void> {
    // Validate room name
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    // Check if there's a validator for this room pattern
    for (const [pattern, validator] of this.roomValidators.entries()) {
      if (roomName.startsWith(pattern) || roomName === pattern) {
        const isValid = await validator(socket, roomName);
        if (!isValid) {
          throw new APIError("Not authorized to join this room", 403);
        }
        break;
      }
    }

    // Add socket to custom room tracking
    if (!this.customRooms.has(roomName)) {
      this.customRooms.set(roomName, new Set());
    }
    this.customRooms.get(roomName)!.add(socket.id);

    // Join the Socket.IO room (prefixed with "room:")
    socket.join(`room:${roomName}`);

    console.log(`User ${socket.userId} joined custom room: ${roomName}`);

    // Notify others in the room
    socket.to(`room:${roomName}`).emit("room:user:joined", {
      room: roomName,
      userId: socket.userId,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle a user leaving a custom room
   */
  handleRoomLeave(socket: SocketWithAuth, roomName: string): void {
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    // Remove from custom room tracking
    if (this.customRooms.has(roomName)) {
      this.customRooms.get(roomName)!.delete(socket.id);
      if (this.customRooms.get(roomName)!.size === 0) {
        this.customRooms.delete(roomName);
      }
    }

    // Leave the Socket.IO room
    socket.leave(`room:${roomName}`);

    console.log(`User ${socket.userId} left custom room: ${roomName}`);

    // Notify others in the room
    this.io?.to(`room:${roomName}`).emit("room:user:left", {
      room: roomName,
      userId: socket.userId,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle a message sent to a custom room
   */
  async handleRoomMessage(socket: SocketWithAuth, roomName: string, event: string, payload: any): Promise<void> {
    if (!roomName || typeof roomName !== "string") {
      throw new APIError("Invalid room name", 400);
    }

    // Check if the socket is in the room
    if (!this.customRooms.has(roomName) || !this.customRooms.get(roomName)!.has(socket.id)) {
      throw new APIError("Not a member of this room", 403);
    }

    // Broadcast to all room members (including sender)
    this.io?.to(`room:${roomName}`).emit(`room:${event}`, {
      room: roomName,
      event,
      payload,
      sender: {
        userId: socket.userId,
        socketId: socket.id,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle custom events with registered handlers
   */
  async handleCustomEvent(
    socket: SocketWithAuth,
    event: string,
    payload: any,
    callback?: (response: any) => void
  ): Promise<void> {
    const handler = this.customMessageHandlers.get(event);
    if (!handler) {
      callback?.({ status: "error", message: `No handler registered for event: ${event}` });
      return;
    }

    await handler(socket, payload, callback);
  }

  // ==========================================
  // Public API for Custom Rooms (for extensions)
  // ==========================================

  /**
   * Register a custom message handler for a specific event
   * Can be used by extensions to handle custom socket events
   * 
   * @example
   * socketService.registerMessageHandler("game:move", async (socket, data, callback) => {
   *   // Handle game move logic
   *   callback?.({ status: "success", result: { ... } });
   * });
   */
  registerMessageHandler(event: string, handler: CustomMessageHandler): void {
    this.customMessageHandlers.set(event, handler);
    console.info(`Registered custom socket handler for event: ${event}`);
  }

  /**
   * Unregister a custom message handler
   */
  unregisterMessageHandler(event: string): void {
    this.customMessageHandlers.delete(event);
    console.info(`Unregistered custom socket handler for event: ${event}`);
  }

  /**
   * Register a validator for room join requests
   * Validator is called when a user tries to join a room matching the pattern
   * 
   * @example
   * socketService.registerRoomValidator("game:", async (socket, roomName) => {
   *   // Only allow admins to join game rooms
   *   return socket.userRole.name === "administrator";
   * });
   */
  registerRoomValidator(roomPattern: string, validator: RoomValidator): void {
    this.roomValidators.set(roomPattern, validator);
    console.info(`Registered room validator for pattern: ${roomPattern}`);
  }

  /**
   * Unregister a room validator
   */
  unregisterRoomValidator(roomPattern: string): void {
    this.roomValidators.delete(roomPattern);
    console.info(`Unregistered room validator for pattern: ${roomPattern}`);
  }

  /**
   * Broadcast a message to a custom room from server side
   * 
   * @example
   * socketService.broadcastToRoom("game:123", "game:state", { players: [...] });
   */
  broadcastToRoom(roomName: string, event: string, payload: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    this.io.to(`room:${roomName}`).emit(event, {
      room: roomName,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast a message to all connected users
   * 
   * @example
   * socketService.broadcastToAll("system:announcement", { message: "Server maintenance in 5 minutes" });
   */
  broadcastToAll(event: string, payload: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    this.io.emit(event, {
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send a message to a specific user (all their connected sockets)
   * 
   * @example
   * socketService.sendToUser(userId, "private:message", { from: "admin", text: "Hello!" });
   */
  sendToUser(userId: string | number, event: string, payload: any): void {
    if (!this.initialized || !this.io) {
      console.warn("Socket service not initialized");
      return;
    }

    const userSocketSet = this.userSockets.get(userId);
    if (userSocketSet) {
      for (const socket of userSocketSet) {
        socket.emit(event, {
          payload,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Get list of users in a custom room
   */
  getRoomMembers(roomName: string): string[] {
    return Array.from(this.customRooms.get(roomName) || []);
  }

  /**
   * Get count of users in a custom room
   */
  getRoomMemberCount(roomName: string): number {
    return this.customRooms.get(roomName)?.size || 0;
  }

  /**
   * Check if a room exists
   */
  roomExists(roomName: string): boolean {
    return this.customRooms.has(roomName) && this.customRooms.get(roomName)!.size > 0;
  }

  /**
   * Get all custom rooms
   */
  getCustomRooms(): Map<string, number> {
    const rooms = new Map<string, number>();
    for (const [name, members] of this.customRooms.entries()) {
      rooms.set(name, members.size);
    }
    return rooms;
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
        customRooms: 0,
        registeredHandlers: 0,
      };
    }

    // Build custom rooms summary
    const customRoomsSummary: Record<string, number> = {};
    for (const [name, members] of this.customRooms.entries()) {
      customRoomsSummary[name] = members.size;
    }

    return {
      status: env.get("SOCKET_REDIS_ENABLED") === "true" ? "redis" : "in-memory",
      totalConnections: this.io.engine.clientsCount,
      uniqueUsers: this.userSockets.size,
      rooms: this.io.sockets.adapter.rooms,
      customRooms: {
        count: this.customRooms.size,
        rooms: customRoomsSummary,
      },
      registeredHandlers: Array.from(this.customMessageHandlers.keys()),
      registeredValidators: Array.from(this.roomValidators.keys()),
    };
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_socketService: SocketService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_socketService) {
  globalThis.__baasix_socketService = new SocketService();
}

const socketService = globalThis.__baasix_socketService;
export default socketService;
