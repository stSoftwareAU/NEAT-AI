/**
 * Worker start heartbeat (Issue #3771).
 *
 * When a pooled worker misses its init handshake the parent can only report
 * what it can see, and the timeout diagnostic (Issue #3494) says so:
 *
 * ```text
 * Child WASM phase timings unknown — the worker never answered the init
 * handshake (may be stuck loading WASM, CPU-starved, or OOM).
 * ```
 *
 * That leaves the two most likely causes indistinguishable. A GRQ-23 `team`
 * run lost five slots with `cache=hit`, `wasmTotalMs=20` and
 * `workerError=none` — the parent's own WASM work took 20 ms, so "stuck
 * loading WASM" was already ruled out, yet nothing in the log said whether the
 * worker isolate had even started.
 *
 * The heartbeat closes that gap with one message: the child posts it as soon
 * as its module has evaluated and its message loop is installed — *before* any
 * init work. The parent records receipt, so the timeout error can report
 * `heartbeat=received` (the isolate started, then stalled — CPU starvation or
 * a stuck init) or `heartbeat=none` (the isolate never got far enough to run
 * its own entry point — spawn starvation or OOM).
 *
 * The message deliberately carries a single, unmistakable field rather than a
 * `taskID`: the parent's callback map is keyed by task and asserts a callback
 * exists for every response, so an unsolicited task-shaped message would
 * throw. {@link isWorkerHeartbeatMessage} lets the parent's listener take the
 * heartbeat off the wire before task routing sees it.
 *
 * @module
 */

/** Field name identifying a heartbeat message. Part of the wire contract. */
export const WORKER_HEARTBEAT_FIELD = "neatAiWorkerHeartbeat";

/** Lifecycle point a heartbeat was emitted from. */
export type WorkerHeartbeatPhase = "loaded";

/** The message a child posts to announce it is alive. */
export interface WorkerHeartbeatMessage {
  [WORKER_HEARTBEAT_FIELD]: { phase: WorkerHeartbeatPhase };
}

/** Build the heartbeat message for `phase`. */
export function buildWorkerHeartbeatMessage(
  phase: WorkerHeartbeatPhase = "loaded",
): WorkerHeartbeatMessage {
  return { [WORKER_HEARTBEAT_FIELD]: { phase } };
}

/**
 * True when `data` is a heartbeat rather than a task response. Callers must
 * check this before routing a message to the task-callback map.
 */
export function isWorkerHeartbeatMessage(
  data: unknown,
): data is WorkerHeartbeatMessage {
  if (typeof data !== "object" || data === null) return false;
  const beat = (data as Record<string, unknown>)[WORKER_HEARTBEAT_FIELD];
  if (typeof beat !== "object" || beat === null) return false;
  return typeof (beat as { phase?: unknown }).phase === "string";
}
