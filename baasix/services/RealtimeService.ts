/**
 * RealtimeService - PostgreSQL WAL-based realtime change data capture
 * 
 * This service uses PostgreSQL logical replication to capture database changes
 * and broadcast them via WebSockets using the existing SocketService.
 * 
 * Similar to Supabase Realtime, it allows enabling realtime on specific collections
 * with granular control over which actions (insert, update, delete) trigger events.
 * 
 * Realtime configuration is stored in the schema definition:
 * {
 *   "realtime": {
 *     "enabled": true,
 *     "actions": ["insert", "update", "delete"]
 *   }
 * }
 * 
 * NOTE: This service ONLY works when PostgreSQL has wal_level=logical configured.
 * If WAL is not available, no realtime broadcasting will occur.
 */

import env from "../utils/env.js";
import { db } from "../utils/db.js";
import { sql, inArray } from "drizzle-orm";

// Types for pg-logical-replication
interface WalMessage {
  tag: 'insert' | 'update' | 'delete' | 'begin' | 'commit' | 'relation' | 'type' | 'origin' | 'message';
  relation?: {
    schema: string;
    name: string;
    columns?: Array<{
      name: string;
      typeOid: number;
      flags: number;
      typeMod: number;
    }>;
  };
  new?: Record<string, any>;
  old?: Record<string, any>;
  key?: Record<string, any>;
}

// Realtime configuration for a collection
export interface RealtimeConfig {
  enabled: boolean;
  actions: Array<'insert' | 'update' | 'delete'>;
}

// Constants
const PUBLICATION_NAME = 'baasix_realtime';
const SLOT_NAME = 'baasix_realtime_slot';
// Redis key for WAL consumer leader election
const WAL_LEADER_KEY = 'baasix:wal:leader';
const WAL_LEADER_TTL = 30; // seconds

/**
 * Custom PgoutputPlugin that doesn't send the 'messages' option
 * This is compatible with PostgreSQL 10+ (the default library sends 'messages' which requires PG 14+)
 */
class CompatiblePgoutputPlugin {
  private options: { protoVersion: number; publicationNames: string[] };
  private parser: any;

  constructor(options: { protoVersion: number; publicationNames: string[] }) {
    this.options = options;
    this.parser = null;
  }

  get name() {
    return 'pgoutput';
  }

  async initParser() {
    if (!this.parser) {
      const { PgoutputParser } = await import('pg-logical-replication/dist/output-plugins/pgoutput/pgoutput-parser.js');
      this.parser = new PgoutputParser();
    }
  }

  parse(buffer: Buffer) {
    return this.parser.parse(buffer);
  }

  start(client: any, slotName: string, lastLsn: string) {
    // Only send proto_version and publication_names - no 'messages' option for PG < 14 compatibility
    const options = [
      `proto_version '${this.options.protoVersion}'`,
      `publication_names '${this.options.publicationNames.join(',')}'`,
    ];
    const sql = `START_REPLICATION SLOT "${slotName}" LOGICAL ${lastLsn} (${options.join(', ')})`;
    return client.query(sql);
  }
}

class RealtimeService {
  private initialized: boolean = false;
  private connected: boolean = false;
  private replicationService: any = null;
  private socketService: any = null;
  // Map of collection name to realtime config
  private collectionConfigs: Map<string, RealtimeConfig> = new Map();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private shuttingDown: boolean = false;
  private walAvailable: boolean = false;
  // Whether this instance is the WAL consumer leader
  private isWalLeader: boolean = false;
  // Unique instance ID for Redis leader election
  private instanceId: string = `${process.pid}-${Date.now()}`;
  // Redis client for leader election
  private redisClient: any = null;
  // Leader lock renewal interval
  private leaderRenewalInterval: NodeJS.Timeout | null = null;

  constructor() {
    console.info("Realtime Service instance created");
  }

  /**
   * Set the socket service instance for broadcasting
   */
  setSocketService(socketService: any): void {
    this.socketService = socketService;
  }

  /**
   * Check if PostgreSQL logical replication is enabled
   */
  async checkLogicalReplicationEnabled(): Promise<{ enabled: boolean; walLevel: string; error?: string }> {
    try {
      const result = await db.execute(sql`SHOW wal_level`);
      const walLevel = (result as any)[0]?.wal_level || 'unknown';
      
      return {
        enabled: walLevel === 'logical',
        walLevel,
        error: walLevel !== 'logical' 
          ? `PostgreSQL wal_level is '${walLevel}'. Logical replication requires wal_level = 'logical'. Please update postgresql.conf and restart PostgreSQL.`
          : undefined
      };
    } catch (error: any) {
      return {
        enabled: false,
        walLevel: 'unknown',
        error: `Failed to check wal_level: ${error.message}`
      };
    }
  }

  /**
   * Check replication configuration
   */
  async checkReplicationConfig(): Promise<{ 
    walLevel: string;
    maxReplicationSlots: number;
    maxWalSenders: number;
    isConfigured: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    
    try {
      const [walLevelResult, slotsResult, sendersResult] = await Promise.all([
        db.execute(sql`SHOW wal_level`),
        db.execute(sql`SHOW max_replication_slots`),
        db.execute(sql`SHOW max_wal_senders`)
      ]);

      const walLevel = (walLevelResult as any)[0]?.wal_level || 'unknown';
      const maxReplicationSlots = parseInt((slotsResult as any)[0]?.max_replication_slots || '0');
      const maxWalSenders = parseInt((sendersResult as any)[0]?.max_wal_senders || '0');

      if (walLevel !== 'logical') {
        issues.push(`wal_level is '${walLevel}', should be 'logical'`);
      }
      if (maxReplicationSlots < 1) {
        issues.push(`max_replication_slots is ${maxReplicationSlots}, should be at least 1`);
      }
      if (maxWalSenders < 1) {
        issues.push(`max_wal_senders is ${maxWalSenders}, should be at least 1`);
      }

      return {
        walLevel,
        maxReplicationSlots,
        maxWalSenders,
        isConfigured: issues.length === 0,
        issues
      };
    } catch (error: any) {
      issues.push(`Failed to check config: ${error.message}`);
      return {
        walLevel: 'unknown',
        maxReplicationSlots: 0,
        maxWalSenders: 0,
        isConfigured: false,
        issues
      };
    }
  }

  /**
   * Initialize the realtime service
   * Creates publication and replication slot if they don't exist
   * Only works when PostgreSQL has wal_level=logical configured
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.warn("Realtime service already initialized");
      return;
    }

    console.info("Initializing Realtime Service...");

    // Check if logical replication is enabled
    const replicationCheck = await this.checkLogicalReplicationEnabled();
    
    if (!replicationCheck.enabled) {
      console.warn(`⚠️ PostgreSQL logical replication not available (wal_level=${replicationCheck.walLevel})`);
      console.warn("   WAL-based realtime is disabled. No automatic broadcasting will occur.");
      console.warn("   To enable, set wal_level=logical in postgresql.conf and restart PostgreSQL.");
      this.walAvailable = false;
      this.initialized = true;
      return;
    }

    this.walAvailable = true;

    // Create publication if it doesn't exist
    await this.ensurePublicationExists();

    // Create replication slot if it doesn't exist
    await this.ensureReplicationSlotExists();

    // Load enabled collections from database
    await this.loadEnabledCollections();

    // Sync publication with enabled collections
    await this.syncPublicationWithCollections();

    this.initialized = true;
    console.info("✅ Realtime Service initialized with WAL support");
  }

  /**
   * Check if WAL-based realtime is available
   */
  isWalAvailable(): boolean {
    return this.walAvailable;
  }

  /**
   * Ensure the publication exists
   */
  private async ensurePublicationExists(): Promise<void> {
    try {
      // Check if publication exists
      const result = await db.execute(sql`
        SELECT pubname FROM pg_publication WHERE pubname = ${PUBLICATION_NAME}
      `);

      if ((result as any[]).length === 0) {
        // Create empty publication (tables will be added as they're enabled)
        await db.execute(sql.raw(`CREATE PUBLICATION ${PUBLICATION_NAME}`));
        console.info(`Created publication: ${PUBLICATION_NAME}`);
      } else {
        console.info(`Publication ${PUBLICATION_NAME} already exists`);
      }
    } catch (error: any) {
      // Handle case where publication already exists (race condition)
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
  }

  /**
   * Ensure the replication slot exists
   */
  private async ensureReplicationSlotExists(): Promise<void> {
    try {
      // Check if slot exists
      const result = await db.execute(sql`
        SELECT slot_name FROM pg_replication_slots WHERE slot_name = ${SLOT_NAME}
      `);

      if ((result as any[]).length === 0) {
        // Create replication slot
        await db.execute(sql.raw(`
          SELECT pg_create_logical_replication_slot('${SLOT_NAME}', 'pgoutput')
        `));
        console.info(`Created replication slot: ${SLOT_NAME}`);
      } else {
        console.info(`Replication slot ${SLOT_NAME} already exists`);
      }
    } catch (error: any) {
      // Handle case where slot already exists (race condition)
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
  }

  /**
   * Load collections with realtime enabled from schema definitions
   * Supports both old format (realtime: true) and new format (realtime: { enabled: true, actions: [...] })
   */
  private async loadEnabledCollections(): Promise<void> {
    try {
      // Query for collections with realtime enabled (supports both old and new format)
      const result = await db.execute(sql`
        SELECT "collectionName", schema 
        FROM "baasix_SchemaDefinition" 
        WHERE schema->>'realtime' = 'true'
           OR schema->'realtime'->>'enabled' = 'true'
      `);

      this.collectionConfigs.clear();
      for (const row of result as any[]) {
        const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
        const realtimeConfig = schema.realtime;
        
        // Handle old format (realtime: true)
        if (realtimeConfig === true) {
          this.collectionConfigs.set(row.collectionName, {
            enabled: true,
            actions: ['insert', 'update', 'delete']
          });
        } 
        // Handle new format (realtime: { enabled: true, actions: [...] })
        else if (typeof realtimeConfig === 'object') {
          this.collectionConfigs.set(row.collectionName, {
            enabled: realtimeConfig.enabled !== false,
            actions: realtimeConfig.actions || ['insert', 'update', 'delete']
          });
        }
      }

      console.info(`Loaded ${this.collectionConfigs.size} realtime-enabled collections`);
    } catch (error: any) {
      console.warn(`Failed to load realtime collections: ${error.message}`);
    }
  }

  /**
   * Sync the PostgreSQL publication with enabled collections
   */
  private async syncPublicationWithCollections(): Promise<void> {
    if (!this.walAvailable) return;

    try {
      // Get current tables in publication
      const currentTables = await db.execute(sql`
        SELECT schemaname, tablename 
        FROM pg_publication_tables 
        WHERE pubname = ${PUBLICATION_NAME}
      `);
      const currentTableNames = new Set((currentTables as any[]).map(t => t.tablename));

      // Add missing tables
      for (const [collectionName, config] of this.collectionConfigs) {
        if (config.enabled && !currentTableNames.has(collectionName)) {
          try {
            await db.execute(sql.raw(`ALTER PUBLICATION ${PUBLICATION_NAME} ADD TABLE "${collectionName}"`));
            console.info(`Added ${collectionName} to publication`);
          } catch (error: any) {
            if (!error.message.includes('already member')) {
              console.warn(`Failed to add ${collectionName} to publication: ${error.message}`);
            }
          }
        }
      }

      // Remove tables that are no longer enabled
      for (const tableName of currentTableNames) {
        const config = this.collectionConfigs.get(tableName);
        if (!config || !config.enabled) {
          try {
            await db.execute(sql.raw(`ALTER PUBLICATION ${PUBLICATION_NAME} DROP TABLE "${tableName}"`));
            console.info(`Removed ${tableName} from publication`);
          } catch (error: any) {
            console.warn(`Failed to remove ${tableName} from publication: ${error.message}`);
          }
        }
      }
    } catch (error: any) {
      console.warn(`Failed to sync publication: ${error.message}`);
    }
  }

  /**
   * Start consuming WAL changes
   */
  async startConsuming(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Realtime service not initialized. Call initialize() first.");
    }

    if (!this.walAvailable) {
      console.info("WAL not available, skipping WAL consumer startup");
      return;
    }

    // Check if WAL consumer is explicitly disabled via environment variable
    if (env.get("REALTIME_WAL_CONSUMER_ENABLED") === "false") {
      console.info("WAL consumer explicitly disabled via REALTIME_WAL_CONSUMER_ENABLED=false");
      return;
    }

    if (this.connected) {
      console.warn("Already consuming WAL changes");
      return;
    }

    // Multi-instance mode: Use Redis for leader election
    // Only one instance should consume WAL to avoid duplicate processing
    if (env.get("SOCKET_REDIS_ENABLED") === "true") {
      const isLeader = await this.tryBecomeWalLeader();
      if (!isLeader) {
        console.info("Another instance is the WAL consumer leader. This instance will not consume WAL.");
        console.info("Realtime broadcasts will still work via Redis adapter.");
        this.isWalLeader = false;
        return;
      }
      this.isWalLeader = true;
      this.startLeaderRenewal();
      console.info("This instance became the WAL consumer leader");
    } else {
      // Single instance mode - no Redis, this instance is the leader
      this.isWalLeader = true;
      console.info("Single instance mode - this instance will consume WAL");
    }

    try {
      // Dynamic import to avoid issues if package is not installed
      const { LogicalReplicationService } = await import('pg-logical-replication');

      const connectionString = env.get("DATABASE_URL");
      if (!connectionString) {
        throw new Error("DATABASE_URL is required for realtime service");
      }

      this.replicationService = new LogicalReplicationService(
        { connectionString },
        { acknowledge: { auto: true, timeoutSeconds: 10 } }
      );

      // Use our compatible plugin that doesn't send the 'messages' option (PG < 14 compatible)
      const plugin = new CompatiblePgoutputPlugin({
        protoVersion: 1,
        publicationNames: [PUBLICATION_NAME]
      });
      await plugin.initParser();

      // Handle incoming WAL messages
      this.replicationService.on('data', (lsn: string, log: WalMessage) => {
        this.handleWalMessage(log);
      });

      // Handle errors
      this.replicationService.on('error', (error: Error) => {
        console.error("Realtime replication error:", error);
        this.handleDisconnect();
      });

      // Start subscription
      await this.replicationService.subscribe(plugin, SLOT_NAME);
      this.connected = true;
      console.info("✅ Started consuming WAL changes");

    } catch (error: any) {
      // Check if this is a "slot already active" error
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('is active for pid') || error.code === '55006') {
        console.warn("WAL replication slot is already active on another connection");
        this.isWalLeader = false;
        this.stopLeaderRenewal();
        await this.releaseWalLeaderLock();
        return;
      }
      console.error("Failed to start WAL consumer:", error);
      throw error;
    }
  }

  /**
   * Try to become the WAL consumer leader using Redis
   * Uses SETNX with TTL - only one instance can hold the key
   */
  private async tryBecomeWalLeader(): Promise<boolean> {
    try {
      const redis = await this.getRedisClient();
      if (!redis) return true; // No Redis = single instance mode

      // Try to set the key only if it doesn't exist (NX), with TTL
      const result = await redis.set(WAL_LEADER_KEY, this.instanceId, 'EX', WAL_LEADER_TTL, 'NX');
      return result === 'OK';
    } catch (error: any) {
      console.warn(`Failed to acquire WAL leader via Redis: ${error.message}`);
      // On Redis error, allow this instance to consume WAL (fallback to single-instance behavior)
      return true;
    }
  }

  /**
   * Start periodic renewal of leader lock
   */
  private startLeaderRenewal(): void {
    if (this.leaderRenewalInterval) return;

    // Renew every 10 seconds (TTL is 30s, so we have buffer)
    this.leaderRenewalInterval = setInterval(async () => {
      try {
        const redis = await this.getRedisClient();
        if (!redis) return;

        // Only renew if we're still the leader
        const currentLeader = await redis.get(WAL_LEADER_KEY);
        if (currentLeader === this.instanceId) {
          await redis.expire(WAL_LEADER_KEY, WAL_LEADER_TTL);
        } else if (currentLeader) {
          // Lost leadership to another instance
          console.warn("Lost WAL consumer leadership to another instance");
          this.isWalLeader = false;
          this.stopLeaderRenewal();
        }
      } catch (error: any) {
        console.warn(`Failed to renew WAL leader lock: ${error.message}`);
      }
    }, 10000);
  }

  /**
   * Stop leader renewal interval
   */
  private stopLeaderRenewal(): void {
    if (this.leaderRenewalInterval) {
      clearInterval(this.leaderRenewalInterval);
      this.leaderRenewalInterval = null;
    }
  }

  /**
   * Release WAL leader lock in Redis
   */
  private async releaseWalLeaderLock(): Promise<void> {
    try {
      const redis = await this.getRedisClient();
      if (!redis) return;

      // Only delete if we're the current leader (atomic check-and-delete)
      const currentLeader = await redis.get(WAL_LEADER_KEY);
      if (currentLeader === this.instanceId) {
        await redis.del(WAL_LEADER_KEY);
        console.info("Released WAL consumer leadership");
      }
    } catch (error: any) {
      console.warn(`Failed to release WAL leader lock: ${error.message}`);
    }
  }

  /**
   * Get or create Redis client for leader election
   * Reuses the same Redis URL as Socket.IO
   */
  private async getRedisClient(): Promise<any> {
    if (env.get("SOCKET_REDIS_ENABLED") !== "true") {
      return null;
    }

    if (this.redisClient) {
      return this.redisClient;
    }

    try {
      const Redis = (await import('ioredis')).default;
      const redisUrl = env.get("SOCKET_REDIS_URL");
      if (!redisUrl) {
        console.warn("SOCKET_REDIS_URL not set, cannot use Redis for WAL leader election");
        return null;
      }

      this.redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > 3) return null; // Stop retrying
          return Math.min(times * 100, 1000);
        },
      });

      this.redisClient.on('error', (err: Error) => {
        console.warn(`Redis client error (WAL leader): ${err.message}`);
      });

      await this.redisClient.connect();
      return this.redisClient;
    } catch (error: any) {
      console.warn(`Failed to create Redis client: ${error.message}`);
      return null;
    }
  }

  /**
   * Handle WAL messages and broadcast changes
   */
  private handleWalMessage(message: WalMessage): void {
    // Only process insert, update, delete
    if (!['insert', 'update', 'delete'].includes(message.tag)) {
      return;
    }

    const relationName = message.relation?.name;
    const schemaName = message.relation?.schema;

    // Skip system schemas
    if (schemaName && schemaName !== 'public') {
      return;
    }

    if (!relationName) {
      return;
    }

    // Get collection config
    const config = this.collectionConfigs.get(relationName);
    if (!config || !config.enabled) {
      return;
    }

    // Check if this action is enabled for this collection
    if (!config.actions.includes(message.tag as 'insert' | 'update' | 'delete')) {
      return;
    }

    // Map WAL tag to action
    const actionMap: Record<string, string> = {
      'insert': 'create',
      'update': 'update',
      'delete': 'delete'
    };

    const action = actionMap[message.tag];
    if (!action) return;

    // Prepare data payload
    let data: Record<string, any>;
    
    if (message.tag === 'delete') {
      // For deletes, use old values or key values
      data = message.old || message.key || {};
    } else {
      // For inserts and updates, use new values
      data = message.new || {};
    }

    // Include old values for updates if available (requires REPLICA IDENTITY FULL)
    const payload: any = { ...data };
    if (message.tag === 'update' && message.old) {
      payload._old = message.old;
    }

    // Broadcast via SocketService
    if (!this.socketService) {
      console.warn("Socket service not set, cannot broadcast change");
      return;
    }
    this.socketService.broadcastChange(relationName, action, payload);
  }

  /**
   * Handle disconnect and attempt reconnection
   */
  private handleDisconnect(): void {
    this.connected = false;

    if (this.shuttingDown) {
      return;
    }

    // Only the leader should attempt reconnection
    if (!this.isWalLeader) {
      return;
    }

    // Single reconnect attempt after 5 seconds
    if (!this.reconnectTimeout) {
      console.info("Realtime connection lost. Attempting reconnect in 5 seconds...");
      this.reconnectTimeout = setTimeout(async () => {
        this.reconnectTimeout = null;
        try {
          // Reset connected state and try again
          await this.startConsuming();
        } catch (error) {
          console.error("Reconnection failed:", error);
          // Release leadership so another instance can try
          this.stopLeaderRenewal();
          await this.releaseWalLeaderLock();
          this.isWalLeader = false;
          console.info("Released WAL leadership after reconnection failure");
        }
      }, 5000);
    }
  }

  /**
   * Enable realtime for a collection with specific actions
   */
  async enableCollection(collectionName: string, actions: Array<'insert' | 'update' | 'delete'> = ['insert', 'update', 'delete']): Promise<void> {
    if (!this.initialized) {
      throw new Error("Realtime service not initialized");
    }

    const config: RealtimeConfig = { enabled: true, actions };
    this.collectionConfigs.set(collectionName, config);

    // Add table to publication if WAL is available
    if (this.walAvailable) {
      try {
        await db.execute(sql.raw(`ALTER PUBLICATION ${PUBLICATION_NAME} ADD TABLE "${collectionName}"`));
        console.info(`Added ${collectionName} to publication`);
      } catch (error: any) {
        if (!error.message.includes('already member')) {
          throw error;
        }
      }
    }

    // Update schema definition with new config format
    await this.updateSchemaRealtimeConfig(collectionName, config);
    console.info(`Enabled realtime for ${collectionName} with actions: ${actions.join(', ')}`);
  }

  /**
   * Disable realtime for a collection
   */
  async disableCollection(collectionName: string): Promise<void> {
    if (!this.initialized) {
      throw new Error("Realtime service not initialized");
    }

    this.collectionConfigs.delete(collectionName);

    // Remove table from publication if WAL is available
    if (this.walAvailable) {
      try {
        await db.execute(sql.raw(`ALTER PUBLICATION ${PUBLICATION_NAME} DROP TABLE "${collectionName}"`));
        console.info(`Removed ${collectionName} from publication`);
      } catch (error: any) {
        if (!error.message.includes('not member') && !error.message.includes('does not exist')) {
          throw error;
        }
      }
    }

    // Update schema definition
    await this.updateSchemaRealtimeConfig(collectionName, { enabled: false, actions: [] });
    console.info(`Disabled realtime for ${collectionName}`);
  }

  /**
   * Update realtime actions for a collection
   */
  async updateCollectionActions(collectionName: string, actions: Array<'insert' | 'update' | 'delete'>): Promise<void> {
    const config = this.collectionConfigs.get(collectionName);
    if (!config || !config.enabled) {
      throw new Error(`Realtime is not enabled for collection: ${collectionName}`);
    }

    config.actions = actions;
    await this.updateSchemaRealtimeConfig(collectionName, config);
    console.info(`Updated realtime actions for ${collectionName}: ${actions.join(', ')}`);
  }

  /**
   * Update the realtime config in schema definition
   */
  private async updateSchemaRealtimeConfig(collectionName: string, config: RealtimeConfig): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE "baasix_SchemaDefinition"
        SET schema = jsonb_set(
          COALESCE(schema::jsonb, '{}'::jsonb),
          '{realtime}',
          ${JSON.stringify(config)}::jsonb
        )
        WHERE "collectionName" = ${collectionName}
      `);
    } catch (error: any) {
      console.warn(`Failed to update schema realtime flag: ${error.message}`);
    }
  }

  /**
   * Set replica identity to FULL for a table (enables old values on UPDATE/DELETE)
   */
  async setReplicaIdentityFull(collectionName: string): Promise<void> {
    try {
      await db.execute(sql.raw(`
        ALTER TABLE "${collectionName}" REPLICA IDENTITY FULL
      `));
      console.info(`Set REPLICA IDENTITY FULL for: ${collectionName}`);
    } catch (error: any) {
      console.error(`Failed to set replica identity: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get realtime config for a collection
   */
  getCollectionConfig(collectionName: string): RealtimeConfig | undefined {
    return this.collectionConfigs.get(collectionName);
  }

  /**
   * Check if a collection has realtime enabled
   */
  isCollectionEnabled(collectionName: string): boolean {
    const config = this.collectionConfigs.get(collectionName);
    return config?.enabled || false;
  }

  /**
   * Get list of enabled collections with their configs
   */
  getEnabledCollections(): Array<{ collection: string; config: RealtimeConfig }> {
    const result: Array<{ collection: string; config: RealtimeConfig }> = [];
    for (const [collection, config] of this.collectionConfigs) {
      if (config.enabled) {
        result.push({ collection, config });
      }
    }
    return result;
  }

  /**
   * Reload collection configs from database and sync publication
   * @param collectionNames - Optional list of collection names to reload. If not provided, reloads all.
   */
  async reloadCollections(collectionNames?: string[]): Promise<void> {
    if (collectionNames && collectionNames.length > 0) {
      // Efficient path: reload only specific collections
      await this.loadSpecificCollections(collectionNames);
      if (this.walAvailable) {
        await this.syncSpecificCollections(collectionNames);
        // Restart the replication stream to pick up publication changes
        await this.restartReplicationStream();
      }
    } else {
      // Full reload
      await this.loadEnabledCollections();
      if (this.walAvailable) {
        await this.syncPublicationWithCollections();
        // Restart the replication stream to pick up publication changes
        await this.restartReplicationStream();
      }
    }
  }

  /**
   * Restart the replication stream to pick up publication changes
   * PostgreSQL logical replication doesn't dynamically detect publication changes,
   * so we need to disconnect and reconnect the stream.
   */
  private async restartReplicationStream(): Promise<void> {
    if (!this.connected || !this.replicationService) {
      console.info("Replication stream not running, no restart needed");
      return;
    }

    console.info("Restarting replication stream to apply publication changes...");
    
    try {
      // Stop the current replication service
      if (this.replicationService) {
        try {
          await this.replicationService.stop();
        } catch (error) {
          // Ignore stop errors
        }
        this.replicationService = null;
      }
      this.connected = false;

      // Small delay to ensure clean disconnect
      await new Promise(resolve => setTimeout(resolve, 500));

      // Restart consuming (non-blocking)
      this.startConsuming().catch((error) => {
        console.error("Failed to restart replication stream:", error);
      });
      
      console.info("Replication stream restart initiated");
    } catch (error: any) {
      console.warn(`Failed to restart replication stream: ${error.message}`);
    }
  }

  /**
   * Load realtime config for specific collections only
   */
  private async loadSpecificCollections(collectionNames: string[]): Promise<void> {
    if (collectionNames.length === 0) return;

    try {
      // Use sql.join to properly construct the IN clause with parameters
      const result = await db.execute(sql`
        SELECT "collectionName", schema 
        FROM "baasix_SchemaDefinition" 
        WHERE "collectionName" IN (${sql.join(collectionNames.map(n => sql`${n}`), sql`, `)})
      `);

      // Update configs for the specified collections
      const foundCollections = new Set<string>();
      for (const row of result as any[]) {
        foundCollections.add(row.collectionName);
        const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
        const realtimeConfig = schema?.realtime;
        
        if (realtimeConfig === true) {
          this.collectionConfigs.set(row.collectionName, {
            enabled: true,
            actions: ['insert', 'update', 'delete']
          });
        } else if (typeof realtimeConfig === 'object' && realtimeConfig?.enabled) {
          this.collectionConfigs.set(row.collectionName, {
            enabled: true,
            actions: realtimeConfig.actions || ['insert', 'update', 'delete']
          });
        } else {
          // Realtime not enabled or disabled - remove from configs
          this.collectionConfigs.delete(row.collectionName);
        }
      }

      // Handle collections that weren't found (might be deleted)
      for (const name of collectionNames) {
        if (!foundCollections.has(name)) {
          this.collectionConfigs.delete(name);
        }
      }

      console.info(`Loaded realtime config for ${collectionNames.length} specific collections`);
    } catch (error: any) {
      console.warn(`Failed to load specific collections: ${error.message}`);
    }
  }

  /**
   * Sync publication for specific collections only
   */
  private async syncSpecificCollections(collectionNames: string[]): Promise<void> {
    if (!this.walAvailable || collectionNames.length === 0) return;

    try {
      // Get current tables in publication
      const currentTables = await db.execute(sql`
        SELECT tablename 
        FROM pg_publication_tables 
        WHERE pubname = ${PUBLICATION_NAME}
      `);
      const currentTableNames = new Set((currentTables as any[]).map(t => t.tablename));

      for (const collectionName of collectionNames) {
        const config = this.collectionConfigs.get(collectionName);
        const isInPublication = currentTableNames.has(collectionName);
        const shouldBeInPublication = config?.enabled || false;

        if (shouldBeInPublication && !isInPublication) {
          // Add to publication
          try {
            await db.execute(sql.raw(`ALTER PUBLICATION ${PUBLICATION_NAME} ADD TABLE "${collectionName}"`));
            console.info(`Added ${collectionName} to publication`);
          } catch (error: any) {
            if (!error.message.includes('already member')) {
              console.warn(`Failed to add ${collectionName} to publication: ${error.message}`);
            }
          }
        } else if (!shouldBeInPublication && isInPublication) {
          // Remove from publication
          try {
            await db.execute(sql.raw(`ALTER PUBLICATION ${PUBLICATION_NAME} DROP TABLE "${collectionName}"`));
            console.info(`Removed ${collectionName} from publication`);
          } catch (error: any) {
            if (!error.message.includes('not member') && !error.message.includes('does not exist')) {
              console.warn(`Failed to remove ${collectionName} from publication: ${error.message}`);
            }
          }
        }
        // If both match (both in or both out), no action needed
      }
    } catch (error: any) {
      console.warn(`Failed to sync specific collections: ${error.message}`);
    }
  }

  /**
   * Get service status
   */
  getStatus(): {
    initialized: boolean;
    connected: boolean;
    walAvailable: boolean;
    isWalLeader: boolean;
    enabledCollections: Array<{ collection: string; config: RealtimeConfig }>;
    publicationName: string;
    slotName: string;
  } {
    return {
      initialized: this.initialized,
      connected: this.connected,
      walAvailable: this.walAvailable,
      isWalLeader: this.isWalLeader,
      enabledCollections: this.getEnabledCollections(),
      publicationName: PUBLICATION_NAME,
      slotName: SLOT_NAME
    };
  }

  /**
   * Cleanup resources on shutdown
   */
  async shutdown(): Promise<void> {
    console.info("Shutting down Realtime Service...");
    this.shuttingDown = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop leader renewal interval
    this.stopLeaderRenewal();

    // Release WAL leader lock if we held it
    if (this.isWalLeader) {
      await this.releaseWalLeaderLock();
      this.isWalLeader = false;
    }

    if (this.replicationService) {
      try {
        await this.replicationService.stop();
      } catch (error) {
        console.warn("Error stopping replication service:", error);
      }
      this.replicationService = null;
    }

    // Cleanup Redis client
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch (error) {
        // Ignore
      }
      this.redisClient = null;
    }

    this.connected = false;
    console.info("Realtime Service shut down");
  }

  /**
   * Drop replication slot (use with caution - only for cleanup)
   */
  async dropReplicationSlot(): Promise<void> {
    try {
      await db.execute(sql.raw(`
        SELECT pg_drop_replication_slot('${SLOT_NAME}')
      `));
      console.info(`Dropped replication slot: ${SLOT_NAME}`);
    } catch (error: any) {
      if (!error.message.includes('does not exist')) {
        throw error;
      }
    }
  }

  /**
   * Drop publication (use with caution - only for cleanup)
   */
  async dropPublication(): Promise<void> {
    try {
      await db.execute(sql.raw(`DROP PUBLICATION IF EXISTS ${PUBLICATION_NAME}`));
      console.info(`Dropped publication: ${PUBLICATION_NAME}`);
    } catch (error: any) {
      console.warn(`Failed to drop publication: ${error.message}`);
    }
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_realtimeService: RealtimeService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_realtimeService) {
  globalThis.__baasix_realtimeService = new RealtimeService();
}

const realtimeService = globalThis.__baasix_realtimeService;
export default realtimeService;
