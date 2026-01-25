/**
 * Worker handler for Intelligent Design scoring operations.
 *
 * This handler manages communication with worker threads that score creatures
 * using `Creature.scoreDir()`. It supports custom cost functions via NeatOptions.
 *
 * @module
 */

import { assert } from "@std/assert";
import type { Creature } from "../../Creature.ts";
import type { NeatOptions } from "../../config/NeatOptions.ts";
import type { ResponseData } from "./ResponseData.ts";

export interface WasmActivationInitPayload {
  /**
   * The wasm-bindgen JS glue code as source text.
   * This is imported by the worker via a `data:` URL so workers don't need
   * filesystem reads to boot WASM.
   */
  jsSource: string;
  /** Raw `wasm_activation_bg.wasm` bytes. */
  wasmBinary: Uint8Array;
}

/**
 * Data structure for requests sent to scoring workers.
 */
export interface RequestData {
  /** Unique identifier for the task */
  taskID: number;
  /** Initialization request (sent once per worker) */
  initialize?: {
    wasmActivation: WasmActivationInitPayload;
  };
  /** Score request data */
  score?: {
    /** UUID of the neuron being tested */
    uuid: string;
    /** JSON string representation of the creature */
    creature: string;
    /** Directory containing scoring data */
    dataDir: string;
    /** NEAT options including custom cost configuration */
    options: NeatOptions;
  };
}

interface WorkerEventListener {
  (worker: WorkerHandler): void;
}

/**
 * Interface for worker implementations.
 */
export interface WorkerInterface {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  postMessage(data: RequestData): void;
  terminate(): void;
}

let globalWorkerID = 0;

let cachedWasmActivationInitPayload: WasmActivationInitPayload | null = null;

function loadWasmActivationInitPayloadOrThrow(): WasmActivationInitPayload {
  if (cachedWasmActivationInitPayload) return cachedWasmActivationInitPayload;

  // Hard requirement: WASM activation must exist for Intelligent Design scoring.
  const repoRoot = new URL("../../../", import.meta.url).pathname;
  const wasmDir = `${repoRoot}wasm_activation/pkg`;

  const jsSource = Deno.readTextFileSync(`${wasmDir}/wasm_activation.js`);
  const wasmBinary = Deno.readFileSync(`${wasmDir}/wasm_activation_bg.wasm`);

  cachedWasmActivationInitPayload = {
    jsSource,
    wasmBinary,
  };
  return cachedWasmActivationInitPayload;
}

/**
 * Manages communication with worker threads for parallel scoring operations.
 *
 * This class handles the creation, communication, and lifecycle management
 * of worker threads used for scoring creatures during Intelligent Design
 * squash improvement scans.
 *
 * @example
 * ```ts
 * const worker = new WorkerHandler();
 * const result = await worker.score(creature, neuronUUID, dataDir, options);
 * console.log(`Score: ${result.score?.score}`);
 * worker.terminate();
 * ```
 */
export class WorkerHandler {
  /** The underlying worker implementation */
  private worker: WorkerInterface;

  /** Counter for generating unique task IDs */
  private taskID = 1;
  /** Unique identifier for this worker instance */
  private workerID = ++globalWorkerID;
  /** Number of currently executing tasks */
  private busyCount = 0;
  /** Map of task IDs to their callback functions */
  private callbacks = new Map<number, CallableFunction>();
  /** Listeners to notify when worker becomes idle */
  private idleListeners: WorkerEventListener[] = [];
  /** Promise that resolves once the worker is initialized */
  private ready: Promise<ResponseData>;

  /**
   * Creates a new WorkerHandler instance.
   */
  constructor() {
    this.worker = new Worker(
      new URL("./deno/worker.ts", import.meta.url).href,
      {
        type: "module",
        name: "id-worker-" + this.workerID,
      },
    );
    this.worker.addEventListener("error", (e) => {
      console.error("Worker error event:", e);
    });
    this.worker.addEventListener("messageerror", (e) => {
      console.error("Worker message error event:", e);
    });

    this.worker.addEventListener("message", (message) => {
      const me = message as MessageEvent;

      this.callback(me.data as ResponseData);
    });

    const wasmActivation = loadWasmActivationInitPayloadOrThrow();
    const initReq: RequestData = {
      taskID: this.taskID++,
      initialize: { wasmActivation },
    };
    this.ready = this.makePromise(initReq).then((result) => {
      assert(
        result.initialize?.status === "OK" && !result.error,
        result.error?.message ??
          "Intelligent Design worker initialization failed",
      );
      return result;
    });
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
  addIdleListener(callback: WorkerEventListener) {
    this.idleListeners.push(callback);
  }

  private callback(data: ResponseData) {
    const call = this.callbacks.get(data.taskID);
    assert(call, "No callback");
    call(data);
    this.callbacks.delete(data.taskID);
  }

  private makePromise(data: RequestData) {
    this.busyCount++;
    const p = new Promise<ResponseData>((resolve) => {
      const call = (result: ResponseData) => {
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
   * Terminates the worker.
   */
  terminate() {
    this.worker.terminate();
    this.idleListeners.length = 0;
  }

  /**
   * Sends a score request to the worker.
   *
   * @param creature - The creature to score
   * @param uuid - UUID of the neuron being tested
   * @param dataDir - Directory containing scoring data
   * @param options - NEAT options (can include customCost)
   * @returns Promise resolving to the scoring result
   */
  score(
    creature: Creature,
    uuid: string,
    dataDir: string,
    options: NeatOptions,
  ): Promise<ResponseData> {
    return this.ready.then(() => {
      const data: RequestData = {
        taskID: this.taskID++,
        score: {
          creature: JSON.stringify(creature.exportJSON(), null, 1),
          uuid: uuid,
          dataDir: dataDir,
          options: options,
        },
      };

      return this.makePromise(data);
    });
  }
}
