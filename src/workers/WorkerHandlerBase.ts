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

import { assert } from "@std/assert";
import v8 from "node:v8";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { getLogger, type Logger } from "@utils/Logger.ts";
import { isWorkerHeartbeatMessage } from "@workers/WorkerHeartbeat.ts";
import {
  formatWorkerInitDiagnostics,
  formatWorkerInitTimeout,
  getLastWasmActivationInitDiagnostics,
} from "@wasm/WasmInitDiagnostics.ts";

interface WorkerEventListener<THandler> {
  (worker: THandler): void;
}

let globalWorkerID = 0;

const BYTES_PER_MB = 1024 * 1024;

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
  /** Map of task IDs to their callback functions */
  private callbacks = new Map<number, CallableFunction>();
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

    this.ready = initReady;
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
      return mockFactory();
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
      getLogger().error(msg, ev.error ?? ev);
    });

    worker.addEventListener("messageerror", (e) => {
      const msg =
        `Worker messageerror event during init (${workerName}) | script=${workerUrl}`;
      const err = new Error(msg, { cause: e });
      onInitError(err);
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
    const startMs = performance.now();
    const initSequence = async (): Promise<TResponse> =>
      await new Promise<TResponse>((resolve, reject) => {
        const timeoutId = setTimeout(
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
                }),
              ),
            ),
          timeoutMs,
        );
        this.makePromise(initRequest).then(
          (r) => {
            clearTimeout(timeoutId);
            resolve(r);
          },
          (err) => {
            clearTimeout(timeoutId);
            reject(err);
          },
        );
      });

    return Promise.race([initSequence(), initErrorPromise]).then((result) => {
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
   */
  private handleCallback(data: TResponse) {
    const call = this.callbacks.get(data.taskID);
    assert(call, "No callback");
    call(data);
    this.callbacks.delete(data.taskID);
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
    const p = new Promise<TResponse>((resolve) => {
      const call = (result: TResponse) => {
        this.onTaskEnd();
        resolve(result);

        if (!this.isBusy()) {
          this.idleListeners.forEach((listener) => listener(this));
        }
      };

      this.callbacks.set(data.taskID, call);
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
      const call = (result: TResponse) => {
        this.onTaskEnd();
        resolve(result);

        if (!this.isBusy()) {
          this.idleListeners.forEach((listener) => listener(this));
        }
      };

      this.callbacks.set(data.taskID, call);

      this.ready.then(() => {
        this.worker.postMessage(data);
        afterPost?.();
      }).catch((err) => {
        this.callbacks.delete(data.taskID);
        this.onTaskEnd();

        if (!this.isBusy()) {
          this.idleListeners.forEach((listener) => listener(this));
        }

        reject(err);
      });
    });

    return p;
  }

  /**
   * Terminates the worker and cleans up resources.
   */
  terminate() {
    this.callbacks.clear();
    this.idleListeners.length = 0;
    this.worker.terminate();
  }
}
