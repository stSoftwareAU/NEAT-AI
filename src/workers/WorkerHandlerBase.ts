/**
 * Shared base class for worker handler implementations.
 *
 * Provides the common lifecycle management, task tracking, promise-based
 * communication, and idle-listener infrastructure shared by both the
 * multithreading and intelligentDesign worker handlers.
 *
 * Issue #1600: Extracted as single source of truth for worker lifecycle.
 *
 * @module
 */

import v8 from "node:v8";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { getLogger, type Logger } from "@utils/Logger.ts";
import { isWorkerHeartbeatMessage } from "@workers/WorkerHeartbeat.ts";
import { WorkerTaskCancelledError } from "@workers/WorkerTaskCancelledError.ts";
import {
  formatWorkerInitDiagnostics,
  formatWorkerInitTimeout,
  getLastWasmActivationInitDiagnostics,
} from "@wasm/WasmInitDiagnostics.ts";

interface WorkerEventListener<THandler> {
  (worker: THandler): void;
}

/**
 * Bookkeeping for one in-flight worker request (GRQ #4489).
 *
 * `settle` delivers the worker's response; `fail` gives up on it. Both run the
 * same busy/idle accounting, so a cancelled task releases its worker slot
 * exactly as a completed one does.
 */
interface PendingTask<TResponse> {
  /** `Date.now()` at dispatch, so a failure can report how long it ran. */
  readonly startedAtMs: number;
  /** Deliver the worker's response. */
  readonly settle: (result: TResponse) => void;
  /** Give up on the task, rejecting its promise. */
  readonly fail: (error: Error) => void;
}

/**
 * Worker → owning-handler routing for worker-level error events
 * (GRQ #4489).
 *
 * The `error`/`messageerror` listeners are attached in
 * {@link WorkerHandlerBase.createWorkerOrMock}, a static method that runs
 * *before* the handler exists, and their only effect used to be rejecting the
 * init promise. After init that left a crashed worker's in-flight tasks
 * pending forever. The handler registers itself here in its constructor so the
 * spawn-site listeners can reach it for the rest of the worker's life.
 *
 * A `WeakMap` keyed by the worker keeps the reference collectable with the
 * worker itself.
 */
const workerErrorSinks = new WeakMap<object, (error: Error) => void>();

/**
 * Deliver a worker-level error to the handler that owns `worker`.
 *
 * Exported for the spawn-site listeners and for tests that simulate a worker
 * crash; a no-op when no handler has registered for that worker.
 */
export function notifyWorkerError(worker: object, error: Error): void {
  workerErrorSinks.get(worker)?.(error);
}

let globalWorkerID = 0;

const BYTES_PER_MB = 1024 * 1024;

/**
 * `performance.now()` at which each worker was spawned, keyed by the worker
 * itself (GRQ #4238).
 *
 * The handshake clock must start at the init request, not at the spawn — but
 * the gap between the two is parent-side work (WASM payload load, scheduling)
 * that an operator needs to see, and burying it inside `handshakeMs` is
 * exactly how a 60s deadline came to report 14m 55s. A `WeakMap` keeps the
 * timestamp off the worker object and lets it be collected with the worker.
 */
const workerSpawnAtMs = new WeakMap<object, number>();

/** Record the spawn instant for `worker`. */
function recordWorkerSpawn(worker: object): void {
  workerSpawnAtMs.set(worker, performance.now());
}

/**
 * Milliseconds from `worker`'s spawn to now, or `undefined` when the spawn
 * instant was not observed (e.g. a worker supplied directly by a test).
 */
function msSinceSpawn(worker: object): number | undefined {
  const spawnAt = workerSpawnAtMs.get(worker);
  return spawnAt === undefined
    ? undefined
    : Math.max(0, performance.now() - spawnAt);
}

/**
 * How often the parent samples its own event loop during a handshake
 * (GRQ #4238), derived from the deadline so short test timeouts still sample.
 */
function loopSampleIntervalMs(timeoutMs: number): number {
  return Math.max(10, Math.min(1000, Math.floor(timeoutMs / 4)));
}

/**
 * Environment variable carrying the externally-set discovery V8 heap target,
 * in MB. Set by the discovery runner (`worker/Discovery/run.sh`,
 * `src/Discovery/Scan.ts`) which lives outside this repo; here it is treated
 * as an input contract the library consumes (Issue #3024).
 */
export const DISCOVERY_HEAP_SIZE_ENV = "DISCOVERY_HEAP_SIZE_MB";

/** Default getter so callers can inject a hermetic env in tests. */
function defaultEnvGet(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    // No --allow-env: behave as if unset rather than throwing.
    return undefined;
  }
}

function parsePositiveIntMb(
  raw: string | undefined | null,
): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parses `--max-old-space-size=<MB>` (or the space-separated form) out of a V8
 * flags string such as the value of `DENO_V8_FLAGS`.
 *
 * @returns the MB value, or undefined when the flag is absent/invalid.
 */
export function parseMaxOldSpaceMb(
  v8Flags: string | undefined | null,
): number | undefined {
  if (!v8Flags) return undefined;
  const m = v8Flags.match(/--max[-_]old[-_]space[-_]size[=\s]+(\d+)/);
  return m ? parsePositiveIntMb(m[1]) : undefined;
}

/**
 * Resolves the V8 old-space heap budget (MB) a spawned discovery worker should
 * run with. Precedence (Issue #3024):
 *   1. `DISCOVERY_HEAP_SIZE_MB` — the explicit external target (input contract).
 *   2. `--max-old-space-size` parsed from the parent's `DENO_V8_FLAGS` — so a
 *      worker inherits the parent's configured heap when no explicit target.
 *
 * @returns the budget in MB, or undefined when neither source yields a
 *   positive integer (worker stays on Deno's default isolate heap, ~269 MB).
 */
export function resolveWorkerHeapBudgetMb(
  getEnv: (key: string) => string | undefined = defaultEnvGet,
): number | undefined {
  return parsePositiveIntMb(getEnv(DISCOVERY_HEAP_SIZE_ENV)) ??
    parseMaxOldSpaceMb(getEnv("DENO_V8_FLAGS"));
}

/**
 * The process-launch flag a worker isolate must inherit to be sized to
 * `budgetMb`. Deno Web Workers inherit the parent's process-level V8 flags but
 * expose no per-worker heap option, so this is the only supported lever.
 */
export function requiredWorkerV8Flag(budgetMb: number): string {
  return `--max-old-space-size=${budgetMb}`;
}

/** The current isolate's V8 old-space heap limit, in MB. */
function readV8HeapLimitMb(): number {
  return Math.round(v8.getHeapStatistics().heap_size_limit / BYTES_PER_MB);
}

/**
 * Verifies — and logs — that a spawned worker's effective V8 old-space heap
 * limit matches the configured discovery budget (Issue #3024).
 *
 * Spawned Web Worker isolates inherit the parent isolate's heap limit, so the
 * parent's limit (read here) is an exact proxy for the worker's. When a budget
 * is configured but the effective limit falls materially short — the GRQ-23
 * regression, where the worker sat on Deno's ~269 MB default while ~4 GB was
 * configured — a warning tells the operator the exact flag the process must be
 * launched with, since runtime env mutation cannot resize an isolate.
 *
 * @returns the resolved budget in MB, or undefined when none is configured.
 */
export function verifyWorkerHeapBudget(
  workerName: string,
  getEnv: (key: string) => string | undefined = defaultEnvGet,
  heapLimitMb: () => number = readV8HeapLimitMb,
  logger: Logger = getLogger(),
): number | undefined {
  const budgetMb = resolveWorkerHeapBudgetMb(getEnv);
  const effectiveMb = heapLimitMb();

  if (budgetMb === undefined) {
    logger.debug(
      `Worker ${workerName}: V8 old-space heap limit ≈ ${effectiveMb} MB ` +
        `(no discovery heap budget configured).`,
    );
    return undefined;
  }

  // Allow ~10% slack: V8 reports heap_size_limit above max-old-space-size
  // (young generation + overhead), e.g. 4096 → ≈4192.
  if (effectiveMb < Math.floor(budgetMb * 0.9)) {
    logger.warn(
      `Worker ${workerName}: V8 old-space heap limit ≈ ${effectiveMb} MB is ` +
        `below the configured discovery budget of ${budgetMb} MB. Launch the ` +
        `process with --v8-flags=${requiredWorkerV8Flag(budgetMb)} (or set ` +
        `DENO_V8_FLAGS) so worker isolates inherit it.`,
    );
  } else {
    logger.info(
      `Worker ${workerName}: V8 old-space heap limit ≈ ${effectiveMb} MB ` +
        `(discovery budget ${budgetMb} MB).`,
    );
  }
  return budgetMb;
}

/**
 * Reads the worker init timeout from the environment.
 *
 * Used by both WorkerHandlerBase constructors and deno/worker.ts entry points.
 * Defaults to 60 seconds; configurable via NEAT_AI_WORKER_INIT_TIMEOUT_MS.
 */
export function getInitTimeoutMs(): number {
  try {
    const v = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
    if (v === null || v === undefined || v === "") return 60_000;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1000 ? n : 60_000;
  } catch {
    return 60_000;
  }
}

/**
 * Base class for worker handlers.
 *
 * Manages task IDs, busy state, callbacks, idle listeners, and worker
 * lifecycle (init timeout, termination). Subclasses provide domain-specific
 * operations (evaluate, train, score, etc.) by calling `makePromise` or
 * `makePromiseDeferred`.
 */
export abstract class WorkerHandlerBase<
  TRequest extends BaseRequestData,
  TResponse extends BaseResponseData,
> {
  /** The underlying worker implementation */
  protected worker: WorkerInterface<TRequest>;

  /** Counter for generating unique task IDs */
  protected taskID = 1;
  /** Unique identifier for this worker instance */
  protected workerID = ++globalWorkerID;
  /** Number of currently executing tasks */
  private busyCount = 0;
  /**
   * Number of currently in-flight long-running tasks (e.g. discover, train).
   *
   * Issue #2161: Allows callers to distinguish workers occupied with
   * long-running operations from those doing quick evaluations.
   */
  private longRunningTaskCount = 0;
  /**
   * Timestamp (ms since epoch) when this worker most recently transitioned
   * from idle (busyCount === 0) to busy (busyCount > 0). Zero when idle.
   *
   * Issue #2330: Used to measure cumulative busy intervals so per-generation
   * throughput metrics can report worker utilisation without per-task hooks
   * in hot paths.
   */
  private busyStartMs = 0;
  /**
   * Cumulative milliseconds this worker has spent busy (i.e. with one or
   * more in-flight tasks). Incremented only on busy→idle transitions.
   *
   * Issue #2330: Low-overhead aggregate used by `WorkerPool.getTotalBusyMs()`
   * to drive the `generation_complete.throughput` counters.
   */
  private cumulativeBusyMs = 0;
  /**
   * In-flight tasks by task id (GRQ #4489).
   *
   * Both halves of the settlement are kept, not just the success callback: a
   * task whose response can never arrive is failed through `fail`, which is
   * what turns a wedged worker from silence into a reported failure.
   */
  private pending = new Map<number, PendingTask<TResponse>>();
  /**
   * False once this handler has been quarantined (GRQ #4489). A quarantined
   * worker is skipped by {@link WorkerPool} selection — a wedged isolate must
   * not be handed the next task.
   */
  private healthy = true;
  /** Listeners to notify when worker becomes idle */
  private idleListeners: WorkerEventListener<this>[] = [];
  /** Promise that resolves once the worker is initialised */
  protected ready: Promise<TResponse>;
  /** Captured worker error during initialisation (if any). */
  protected initWorkerError?: Error;
  /**
   * `performance.now()` at which the child's start heartbeat arrived, or
   * `undefined` when it never did (Issue #3771). This is what separates a
   * child that never started from one that started and then stalled.
   */
  private heartbeatAtMs?: number;

  /**
   * Creates a new WorkerHandlerBase.
   *
   * @param worker - The underlying worker implementation
   * @param initReady - Promise that resolves once the worker is initialised
   */
  constructor(
    worker: WorkerInterface<TRequest>,
    initReady: Promise<TResponse>,
  ) {
    this.worker = worker;

    this.worker.addEventListener("message", (message) => {
      const me = message as MessageEvent;
      // Issue #3771: the child's start heartbeat is not a task response —
      // take it off the wire before task routing, which asserts a callback
      // exists for every message it sees.
      if (isWorkerHeartbeatMessage(me.data)) {
        this.heartbeatAtMs = performance.now();
        return;
      }
      this.handleCallback(me.data as TResponse);
    });

    // GRQ #4489: let the spawn-site error listeners reach this instance, so a
    // worker that dies after init fails its in-flight tasks instead of
    // stranding them.
    workerErrorSinks.set(this.worker as object, (error: Error) => {
      this.onWorkerError(error);
    });

    this.ready = initReady;
  }

  /**
   * Handle a worker-level `error`/`messageerror` event (GRQ #4489).
   *
   * Before this, such an event was logged and dropped once init had completed,
   * so every task in flight on the dead worker stayed pending for the rest of
   * the run. A crashed worker cannot answer: fail its work with the crash as
   * the cause and take it out of service.
   */
  protected onWorkerError(error: Error): void {
    this.quarantine(`worker error event: ${error.message}`, error);
  }

  /**
   * Creates a real Deno Worker or MockWorker and attaches error listeners.
   *
   * Shared between multithreading and intelligentDesign constructors to reduce
   * duplicated worker-creation and error-capture boilerplate.
   */
  protected static createWorkerOrMock<TReq extends BaseRequestData>(
    direct: boolean,
    workerUrl: string,
    workerName: string,
    mockFactory: () => WorkerInterface<TReq>,
    onInitError: (err: Error) => void,
  ): WorkerInterface<TReq> {
    if (direct) {
      const mock = mockFactory();
      recordWorkerSpawn(mock as object);
      return mock;
    }

    // Issue #3024: size the spawned worker's V8 heap to the configured
    // discovery budget. Chosen Deno mechanism + its limits:
    //   - Deno's `Worker` constructor has NO per-worker heap option (unlike
    //     Node's `worker_threads` `resourceLimits.maxOldGenerationSizeMb`).
    //   - Worker isolates DO inherit the parent's process-level V8 flags, so
    //     launching with `--v8-flags=--max-old-space-size=<budget>` (or
    //     `DENO_V8_FLAGS`) sizes every worker. Verified on Deno 2.8.3: a
    //     worker reports the same `heap_size_limit` as the parent isolate.
    //   - Mutating `DENO_V8_FLAGS` at runtime before `new Worker` does NOT
    //     resize the isolate — flags are read once at process start.
    // The external discovery runner (out of this repo) launches the process
    // with the flag derived from `DISCOVERY_HEAP_SIZE_MB`. Here we consume that
    // input contract and verify/log the effective worker heap limit, warning
    // loudly when the process was not launched with a matching flag.
    verifyWorkerHeapBudget(workerName);

    const worker = new Worker(workerUrl, {
      type: "module",
      name: workerName,
    }) as unknown as WorkerInterface<TReq>;

    // GRQ #4238: the spawn instant, so the init diagnostics can report the
    // spawn→init gap as its own field instead of folding it into handshakeMs.
    recordWorkerSpawn(worker as object);

    worker.addEventListener("error", (e) => {
      const ev = e as ErrorEvent;
      const msg = [
        `Worker error event during init (${workerName})`,
        `script=${workerUrl}`,
        ev.message ? `message=${ev.message}` : null,
        ev.filename ? `file=${ev.filename}:${ev.lineno}:${ev.colno}` : null,
      ].filter(Boolean).join(" | ");
      const err = new Error(msg, { cause: ev.error });
      onInitError(err);
      // GRQ #4489: after init, `onInitError` is a no-op — without this the
      // crash was logged and every in-flight task stayed pending forever.
      notifyWorkerError(worker, err);
      getLogger().error(msg, ev.error ?? ev);
    });

    worker.addEventListener("messageerror", (e) => {
      const msg =
        `Worker messageerror event during init (${workerName}) | script=${workerUrl}`;
      const err = new Error(msg, { cause: e });
      onInitError(err);
      notifyWorkerError(worker, err);
      getLogger().error(msg, e);
    });

    return worker;
  }

  /**
   * Creates an init sequence with timeout, suitable for both worker systems.
   *
   * Wraps a `makePromise` call with a timeout and races against an
   * init-error promise so that worker crashes during startup cause fast failure.
   *
   * Issue #3494: emits one compact, greppable `info` line per successful init
   * (the `[WasmWorkerInit]` contract — always on, never gated) and, on a
   * handshake timeout, embeds the parent-observed phase breakdown in the
   * thrown error message so the stall is diagnosable from the log alone. This
   * base method is the single choke point every pooled worker reaches via
   * `waitUntilReady()`, so instrumenting it here covers every fallback site
   * (discovery replay, discovery, improve-squash, creature training, episode
   * pool) without per-site changes.
   *
   * @param workerLabel - Stable label for the worker slot (e.g. `worker-3`),
   *   used in the diagnostics line. Defaults to `worker-<workerID>`.
   */
  protected createInitSequence(
    initRequest: TRequest,
    initErrorPromise: Promise<never>,
    timeoutMs: number,
    workerLabel: string = `worker-${this.workerID}`,
  ): Promise<TResponse> {
    // Elapsed-time measurement (parent-observed handshake), not a wall-clock
    // instant — `performance.now()` is the correct tool per project policy.
    // GRQ #4238: the spawn→init gap is measured separately so it can never be
    // billed to the handshake.
    const spawnToInitMs = msSinceSpawn(this.worker as object);
    const startMs = performance.now();

    // GRQ #4238: sample the parent's own event loop for the length of the
    // handshake. A parent that blocks and recovers before the deadline never
    // shows up as timer overshoot, yet it could not have received the child's
    // heartbeat while blocked — without this the parent's stall is misread as
    // "the child never started".
    const sampleMs = loopSampleIntervalMs(timeoutMs);
    let lastTickMs = startMs;
    let loopBlockedMs = 0;
    const observeLoop = (): number => {
      const now = performance.now();
      loopBlockedMs = Math.max(loopBlockedMs, now - lastTickMs - sampleMs);
      lastTickMs = now;
      return loopBlockedMs;
    };
    const watchdogId = setInterval(observeLoop, sampleMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const stopTimers = () => {
      clearInterval(watchdogId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };

    const initSequence = async (): Promise<TResponse> =>
      await new Promise<TResponse>((resolve, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                formatWorkerInitTimeout({
                  workerLabel,
                  timeoutMs,
                  elapsedMs: performance.now() - startMs,
                  wasm: getLastWasmActivationInitDiagnostics(),
                  workerError: this.initWorkerError,
                  // Clamped: a heartbeat that beat the init request to the
                  // parent is 0 ms into the handshake, never negative.
                  heartbeatMs: this.heartbeatAtMs === undefined
                    ? undefined
                    : Math.max(0, this.heartbeatAtMs - startMs),
                  // Fold in the block that delayed this very callback.
                  loopBlockedMs: observeLoop(),
                  spawnToInitMs,
                }),
              ),
            ),
          timeoutMs,
        );
        this.makePromise(initRequest).then(resolve, reject);
      });

    // `finally` also clears the timers when `initErrorPromise` wins the race —
    // previously that path left the init timeout pending.
    return Promise.race([initSequence(), initErrorPromise])
      .finally(stopTimers)
      .then((result) => {
        // Normal path: one always-on structured line per worker init.
        getLogger().info(
          formatWorkerInitDiagnostics({
            workerLabel,
            handshakeMs: performance.now() - startMs,
            wasm: getLastWasmActivationInitDiagnostics(),
            workerError: this.initWorkerError,
          }),
        );
        return result;
      });
  }

  /**
   * Wait until the worker has completed initialisation.
   *
   * Useful to avoid cold-cache download storms when creating many workers.
   */
  waitUntilReady(): Promise<void> {
    return this.ready.then(() => undefined);
  }

  /**
   * Checks if the worker is currently busy with tasks.
   *
   * @returns True if the worker has pending tasks, false otherwise
   */
  isBusy(): boolean {
    return this.busyCount > 0;
  }

  /**
   * Checks whether the worker is currently running a long-running task
   * (e.g. discover or train).
   *
   * Issue #2161: Callers like Fitness.calculate() can use this to skip
   * workers occupied with long tasks and route work elsewhere.
   *
   * @returns True if one or more long-running tasks are in flight
   */
  isRunningLongTask(): boolean {
    return this.longRunningTaskCount > 0;
  }

  /**
   * Increments the long-running task counter.
   *
   * Subclasses should call this before dispatching a long-running
   * operation (discover, train).
   */
  protected incrementLongRunningTaskCount(): void {
    this.longRunningTaskCount++;
  }

  /**
   * Decrements the long-running task counter.
   *
   * Subclasses should call this when a long-running operation completes
   * (success or error).
   */
  protected decrementLongRunningTaskCount(): void {
    this.longRunningTaskCount--;
  }

  /**
   * Adds a listener to be notified when the worker becomes idle.
   *
   * @param callback - Function to call when worker becomes idle
   */
  addIdleListener(callback: WorkerEventListener<this>) {
    this.idleListeners.push(callback);
  }

  /**
   * Handles an incoming response from the worker.
   *
   * GRQ #4489: a response for a task that is no longer pending is expected
   * once tasks can be cancelled — a wedged worker may answer long after its
   * task was given up on. Report and drop it. This used to assert, and an
   * assertion here escapes the worker's message listener as an uncaught error,
   * killing the run over a late reply.
   */
  private handleCallback(data: TResponse) {
    const task = this.pending.get(data.taskID);
    if (!task) {
      getLogger().warn(
        `[worker-${this.workerID}] response for task ${data.taskID} arrived ` +
          `after the task was settled or cancelled — discarded (GRQ #4489)`,
      );
      return;
    }
    this.pending.delete(data.taskID);
    task.settle(data);
  }

  /**
   * Register an in-flight task and return its settlement callbacks.
   *
   * Both paths run the same accounting: end the task, notify idle listeners
   * when the worker drained, then settle the caller's promise.
   */
  private registerPending(
    taskID: number,
    resolve: (result: TResponse) => void,
    reject: (error: Error) => void,
  ): void {
    const finish = () => {
      this.onTaskEnd();
      if (!this.isBusy()) {
        this.idleListeners.forEach((listener) => listener(this));
      }
    };

    this.pending.set(taskID, {
      startedAtMs: Date.now(),
      settle: (result: TResponse) => {
        finish();
        resolve(result);
      },
      fail: (error: Error) => {
        finish();
        reject(error);
      },
    });
  }

  /** Number of tasks dispatched to this worker that have not yet settled. */
  getPendingTaskCount(): number {
    return this.pending.size;
  }

  /**
   * True while this worker may be given new work (GRQ #4489).
   *
   * Turns false once the worker is quarantined — it crashed, or it swallowed a
   * task past its deadline.
   */
  isHealthy(): boolean {
    return this.healthy;
  }

  /**
   * Give up on one in-flight task, settling its promise as a failure
   * (GRQ #4489).
   *
   * @param taskID task id returned when the request was dispatched
   * @param reason operator-facing reason, e.g. the deadline that was missed
   * @param cause underlying fault, when one was observed
   * @returns true when a pending task was cancelled, false when there was
   *   nothing to cancel (it had already settled)
   */
  cancelTask(taskID: number, reason: string, cause?: Error): boolean {
    const task = this.pending.get(taskID);
    if (!task) return false;

    this.pending.delete(taskID);
    const error = new WorkerTaskCancelledError({
      taskID,
      workerID: this.workerID,
      elapsedMs: Date.now() - task.startedAtMs,
      reason,
      cause,
    });
    getLogger().warn(error.message);
    task.fail(error);
    return true;
  }

  /**
   * Cancel every in-flight task on this worker (GRQ #4489).
   *
   * @returns how many tasks were cancelled
   */
  cancelAllTasks(reason: string, cause?: Error): number {
    let cancelled = 0;
    for (const taskID of Array.from(this.pending.keys())) {
      if (this.cancelTask(taskID, reason, cause)) cancelled++;
    }
    return cancelled;
  }

  /**
   * Take this worker out of service (GRQ #4489).
   *
   * A worker that crashed, or that never answered a task inside its deadline,
   * cannot be trusted with the next one: on GRQ-22-rocket the same two task
   * ids were abandoned twice in a single run. Quarantine fails whatever is
   * still in flight, marks the handler unhealthy so {@link WorkerPool} stops
   * selecting it, and stops the isolate.
   */
  quarantine(reason: string, cause?: Error): void {
    if (!this.healthy) return;
    this.healthy = false;
    getLogger().warn(
      `[worker-${this.workerID}] quarantined — ${reason}; it will not be ` +
        `given further work (GRQ #4489)`,
    );
    this.cancelAllTasks(reason, cause);
    this.worker.terminate();
  }

  /**
   * Records that a task has begun; if this is the first in-flight task,
   * capture the busy-interval start timestamp.
   *
   * Issue #2330: Cheap transitions keep throughput accounting out of hot
   * paths — only idle↔busy edges read the clock, not every task.
   */
  private onTaskStart(): void {
    if (this.busyCount === 0) {
      this.busyStartMs = Date.now();
    }
    this.busyCount++;
  }

  /**
   * Records that a task has ended; if the worker just became idle, fold
   * the elapsed interval into `cumulativeBusyMs`.
   *
   * Issue #2330: Called from both the success callback and the deferred
   * reject path so failed tasks still contribute to busy accounting.
   */
  private onTaskEnd(): void {
    this.busyCount--;
    if (this.busyCount === 0 && this.busyStartMs > 0) {
      this.cumulativeBusyMs += Date.now() - this.busyStartMs;
      this.busyStartMs = 0;
    }
  }

  /**
   * Returns cumulative milliseconds this worker has spent busy since it
   * was created.
   *
   * Issue #2330: Callers snapshot this at phase/generation boundaries and
   * subtract to compute per-window busy time with zero per-task overhead.
   */
  getCumulativeBusyMs(): number {
    return this.cumulativeBusyMs;
  }

  /**
   * Creates a promise for a request and posts it immediately.
   *
   * @param data - The request data to send
   * @returns Promise resolving to the worker's response
   */
  protected makePromise(data: TRequest): Promise<TResponse> {
    this.onTaskStart();
    const p = new Promise<TResponse>((resolve, reject) => {
      this.registerPending(data.taskID, resolve, reject);
    });

    this.worker.postMessage(data);
    return p;
  }

  /**
   * Creates a promise for a request that is deferred until the worker is ready.
   *
   * Unlike `makePromise`, this method increments `busyCount` immediately so that
   * `isBusy()` reflects queued work even while the worker is still initialising.
   * The actual message is posted only after `this.ready` resolves.
   *
   * @param data - The request data to send
   * @param afterPost - Optional callback invoked after postMessage completes
   *   the structured clone. Use this to null large request fields that are no
   *   longer needed, reducing memory pressure while the response is in flight.
   * @returns Promise resolving to the worker's response
   */
  protected makePromiseDeferred(
    data: TRequest,
    afterPost?: () => void,
  ): Promise<TResponse> {
    this.onTaskStart();

    const p = new Promise<TResponse>((resolve, reject) => {
      this.registerPending(data.taskID, resolve, reject);

      this.ready.then(() => {
        this.worker.postMessage(data);
        afterPost?.();
      }).catch((err) => {
        const task = this.pending.get(data.taskID);
        if (!task) return;
        this.pending.delete(data.taskID);
        task.fail(err instanceof Error ? err : new Error(String(err)));
      });
    });

    return p;
  }

  /**
   * Terminates the worker and cleans up resources.
   *
   * GRQ #4489: dropping in-flight tasks here leaves their promises pending
   * forever. Teardown is not the place to change a run's control flow, so the
   * callbacks are still dropped — but never silently: what was lost is named.
   * Use {@link quarantine} when a worker is taken out of service mid-run, so
   * its work fails loudly instead.
   */
  terminate() {
    if (this.pending.size > 0) {
      getLogger().warn(
        `[worker-${this.workerID}] terminated with ${this.pending.size} ` +
          `task(s) still in flight (${
            Array.from(this.pending.keys()).join(", ")
          }) — their results are lost (GRQ #4489)`,
      );
    }
    this.pending.clear();
    this.idleListeners.length = 0;
    this.worker.terminate();
  }
}
