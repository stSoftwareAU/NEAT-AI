/**
 * Worker log relay (Issue #4146).
 *
 * A worker isolate's `getLogger()` writes to the worker's own console, which
 * the parent never sees. When the parent needs a worker-side line (for example
 * the per-task `[training-backend]` report), the child posts it as a log
 * message and the parent writes it to its own logger.
 *
 * Like the start heartbeat (Issue #3771), the message carries one unmistakable
 * field rather than a `taskID`: the parent's callback map is keyed by task and
 * asserts a callback exists for every response, so an unsolicited task-shaped
 * message would throw. {@link routeWorkerLogMessage} takes the log message off
 * the wire before task routing sees it.
 *
 * @module
 */

import type { Logger } from "@utils/Logger.ts";

/** Field name identifying a relayed log message. Part of the wire contract. */
export const WORKER_LOG_FIELD = "neatAiWorkerLog";

/** Severities a worker may relay. */
export type WorkerLogLevel = "info" | "warn";

/** The message a child posts to have the parent log a line. */
export interface WorkerLogMessage {
  [WORKER_LOG_FIELD]: { level: WorkerLogLevel; message: string };
}

/** Build a relayed log message. */
export function buildWorkerLogMessage(
  level: WorkerLogLevel,
  message: string,
): WorkerLogMessage {
  return { [WORKER_LOG_FIELD]: { level, message } };
}

/**
 * True when `data` is a well-formed relayed log message: the level is exactly
 * `info` or `warn` and the message is a string. Callers must check this before
 * routing a message to the task-callback map.
 */
export function isWorkerLogMessage(data: unknown): data is WorkerLogMessage {
  if (typeof data !== "object" || data === null) return false;
  const entry = (data as Record<string, unknown>)[WORKER_LOG_FIELD];
  if (typeof entry !== "object" || entry === null) return false;
  const { level, message } = entry as { level?: unknown; message?: unknown };
  if (level !== "info" && level !== "warn") return false;
  return typeof message === "string";
}

/**
 * Log a relayed message through `logger` and return `true`. Any other message
 * is left alone and `false` is returned, so the caller routes it as a task
 * response.
 */
export function routeWorkerLogMessage(data: unknown, logger: Logger): boolean {
  if (!isWorkerLogMessage(data)) return false;
  const { level, message } = data[WORKER_LOG_FIELD];
  logger[level](message);
  return true;
}
