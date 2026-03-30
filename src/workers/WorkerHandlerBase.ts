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
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { getLogger } from "@utils/Logger.ts";

interface WorkerEventListener<THandler> {
  (worker: THandler): void;
}

let globalWorkerID = 0;

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
  /** Map of task IDs to their callback functions */
  private callbacks = new Map<number, CallableFunction>();
  /** Listeners to notify when worker becomes idle */
  private idleListeners: WorkerEventListener<this>[] = [];
  /** Promise that resolves once the worker is initialised */
  protected ready: Promise<TResponse>;
  /** Captured worker error during initialisation (if any). */
  protected initWorkerError?: Error;

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
   */
  protected createInitSequence(
    initRequest: TRequest,
    initErrorPromise: Promise<never>,
    timeoutMs: number,
  ): Promise<TResponse> {
    const initSequence = async (): Promise<TResponse> =>
      await new Promise<TResponse>((resolve, reject) => {
        const timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `Worker init: no response after ${
                  timeoutMs / 1000
                }s. Worker may have crashed or be stuck loading WASM.${
                  this.initWorkerError
                    ? ` First worker error: ${this.initWorkerError.message}`
                    : ""
                }`,
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

    return Promise.race([initSequence(), initErrorPromise]);
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
   * Creates a promise for a request and posts it immediately.
   *
   * @param data - The request data to send
   * @returns Promise resolving to the worker's response
   */
  protected makePromise(data: TRequest): Promise<TResponse> {
    this.busyCount++;
    const p = new Promise<TResponse>((resolve) => {
      const call = (result: TResponse) => {
        this.busyCount--;
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
   * @returns Promise resolving to the worker's response
   */
  protected makePromiseDeferred(data: TRequest): Promise<TResponse> {
    this.busyCount++;

    const p = new Promise<TResponse>((resolve, reject) => {
      const call = (result: TResponse) => {
        this.busyCount--;
        resolve(result);

        if (!this.isBusy()) {
          this.idleListeners.forEach((listener) => listener(this));
        }
      };

      this.callbacks.set(data.taskID, call);

      this.ready.then(() => {
        this.worker.postMessage(data);
      }).catch((err) => {
        this.callbacks.delete(data.taskID);
        this.busyCount--;

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
