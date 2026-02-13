/**
 * Structured logging abstraction for NEAT-AI.
 *
 * Issue #1398: Replace scattered console logging with a configurable logger
 * that consumers can override for integration with external logging systems.
 */

/**
 * Log level enumeration ordered by severity.
 *
 * Messages at or above the configured level are emitted; lower-severity
 * messages are silently dropped.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

/**
 * Logger interface with standard log levels.
 *
 * Consumers may implement this interface to redirect NEAT-AI log output
 * to their own logging infrastructure (e.g. pino, winston, cloud logging).
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Numeric severity values for comparing log levels. */
const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Creates the default logger that delegates to `console` methods,
 * filtered by the given log level.
 *
 * @param level - Minimum severity to emit. Defaults to `"info"`.
 * @returns A {@link Logger} that writes to the console.
 */
export function createConsoleLogger(level?: LogLevel): Logger {
  const effectiveLevel = level ?? "info";
  const threshold = LOG_LEVEL_SEVERITY[effectiveLevel];

  return {
    debug(...args: unknown[]) {
      if (threshold <= LOG_LEVEL_SEVERITY.debug) {
        console.debug(...args);
      }
    },
    info(...args: unknown[]) {
      if (threshold <= LOG_LEVEL_SEVERITY.info) {
        console.info(...args);
      }
    },
    warn(...args: unknown[]) {
      if (threshold <= LOG_LEVEL_SEVERITY.warn) {
        console.warn(...args);
      }
    },
    error(...args: unknown[]) {
      if (threshold <= LOG_LEVEL_SEVERITY.error) {
        console.error(...args);
      }
    },
  };
}

/**
 * A silent logger that discards all messages.
 *
 * Useful for silencing output during tests or when logging is unwanted.
 */
export const SILENT_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Global logger instance used by NEAT-AI internals.
 *
 * Defaults to a console logger at `"info"` level. Call {@link setLogger}
 * to replace it, or pass a custom logger via NeatOptions.
 */
let _globalLogger: Logger = createConsoleLogger("info");

/** Returns the current global logger. */
export function getLogger(): Logger {
  return _globalLogger;
}

/**
 * Replaces the global logger.
 *
 * @param logger - The new logger to use globally.
 */
export function setLogger(logger: Logger): void {
  _globalLogger = logger;
}
