import pino, { Logger, LoggerOptions, DestinationStream, TransportTargetOptions } from "pino";
import env from "./env.js";

// Logger configuration type that users can pass to startServer
export interface BaasixLoggerOptions {
  /** Pino log level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent' */
  level?: pino.LevelWithSilentOrString;
  /** Custom pino transport configuration */
  transport?: {
    target: string;
    options?: Record<string, unknown>;
  } | {
    targets: TransportTargetOptions[];
  };
  /** Additional pino options */
  options?: Omit<LoggerOptions, 'level' | 'transport'>;
  /** Custom destination stream (if not using transport) */
  destination?: DestinationStream;
  /** Enable pretty printing in development (uses pino-pretty) */
  pretty?: boolean;
}

// Default logger instance - will be initialized with initializeLogger
let logger: Logger;

// Track if logger has been initialized
let isInitialized = false;

/**
 * Initialize the logger with custom options
 * This should be called once at server startup
 */
export function initializeLogger(options?: BaasixLoggerOptions): Logger {
  const debugging = env.get("DEBUGGING") === "true";
  const nodeEnv = env.get("NODE_ENV") || "development";
  const isPretty = options?.pretty ?? (nodeEnv === "development");
  
  // Determine log level from options, env, or defaults
  const level = options?.level 
    ?? env.get("LOG_LEVEL") 
    ?? (debugging ? "debug" : "info");

  // Build pino options
  const pinoOptions: LoggerOptions = {
    level,
    ...options?.options,
  };

  // If transport is specified, use it
  if (options?.transport) {
    pinoOptions.transport = options.transport;
    logger = pino(pinoOptions);
  } 
  // If destination is specified, use it
  else if (options?.destination) {
    logger = pino(pinoOptions, options.destination);
  }
  // If pretty mode is enabled, use pino-pretty transport
  else if (isPretty) {
    pinoOptions.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
    logger = pino(pinoOptions);
  }
  // Default: stdout (stdio)
  else {
    logger = pino(pinoOptions);
  }

  isInitialized = true;

  // Override console methods to use pino logger
  overrideConsoleMethods();

  return logger;
}

/**
 * Get the logger instance
 * If not initialized, creates a default logger
 */
export function getLogger(): Logger {
  if (!isInitialized) {
    return initializeLogger();
  }
  return logger;
}

/**
 * Override console methods to use pino logger
 * This maintains backward compatibility with existing code using console.*
 */
function overrideConsoleMethods(): void {
  const debugging = env.get("DEBUGGING") === "true";

  // Store original console methods for potential direct access
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  // Override console.log - only logs when debugging is enabled (maps to debug level)
  console.log = function (...args: unknown[]) {
    if (debugging) {
      if (args.length === 1 && typeof args[0] === "string") {
        logger.debug(args[0]);
      } else if (args.length === 1) {
        logger.debug(args[0] as object);
      } else {
        logger.debug({ data: args }, String(args[0]));
      }
    }
  };

  // Override console.info - always logs (maps to info level)
  console.info = function (...args: unknown[]) {
    if (args.length === 1 && typeof args[0] === "string") {
      logger.info(args[0]);
    } else if (args.length === 1) {
      logger.info(args[0] as object);
    } else {
      logger.info({ data: args }, String(args[0]));
    }
  };

  // Override console.warn - always logs (maps to warn level)
  console.warn = function (...args: unknown[]) {
    if (args.length === 1 && typeof args[0] === "string") {
      logger.warn(args[0]);
    } else if (args.length === 1) {
      logger.warn(args[0] as object);
    } else {
      logger.warn({ data: args }, String(args[0]));
    }
  };

  // Override console.error - always logs (maps to error level)
  console.error = function (...args: unknown[]) {
    if (args.length === 1 && typeof args[0] === "string") {
      logger.error(args[0]);
    } else if (args.length === 1 && args[0] instanceof Error) {
      logger.error(args[0]);
    } else if (args.length === 1) {
      logger.error(args[0] as object);
    } else {
      logger.error({ data: args }, String(args[0]));
    }
  };

  // Override console.debug - only logs when debugging is enabled
  console.debug = function (...args: unknown[]) {
    if (debugging) {
      if (args.length === 1 && typeof args[0] === "string") {
        logger.debug(args[0]);
      } else if (args.length === 1) {
        logger.debug(args[0] as object);
      } else {
        logger.debug({ data: args }, String(args[0]));
      }
    }
  };

  // Store original console methods for direct access if needed
  (globalThis as Record<string, unknown>).__originalConsole = originalConsole;
}

/**
 * Get original console methods (before override)
 */
export function getOriginalConsole() {
  return (globalThis as Record<string, unknown>).__originalConsole as {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  } | undefined;
}

// Export the logger getter as default
export default getLogger;

// Export pino types for convenience
export type { Logger, LoggerOptions, DestinationStream } from "pino";
