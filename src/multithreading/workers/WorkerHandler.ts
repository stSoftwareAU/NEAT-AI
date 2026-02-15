import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import type { CostName } from "../../Costs.ts";
import type { Creature } from "../../Creature.ts";
import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type {
  CoordinatedStructuralCandidate,
} from "../../architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import type { RemovalCandidate } from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { NeatConfig } from "../../config/NeatConfig.ts";
import type { TrainOptions } from "../../config/TrainOptions.ts";
import { getLogger } from "../../utils/Logger.ts";
import { MockWorker } from "./MockWorker.ts";

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
 * Data structure for requests sent to workers.
 *
 * Defines the format of messages sent from the main thread to worker threads
 * for various operations like evaluation, training, and discovery.
 */
export interface RequestData {
  /** Unique identifier for the task */
  taskID: number;
  /** Debug flag for verbose logging */
  debug?: boolean;
  /** Initialization data for worker setup */
  initialize?: {
    /** Directory containing the dataset */
    dataSetDir: string;
    /** Name of the cost function to use */
    costName: CostName;
    /** Serialized custom cost function data (if using custom cost) */
    customCostData?: string;
    /**
     * When true, enables verbose NEAT-AI-Discovery logging inside the worker
     * by exporting `NEAT_AI_DISCOVERY_VERBOSE=1` before any discovery calls.
     *
     * Note (29-Dec-2025): This is only best-effort - it requires env permissions
     * in the worker runtime. When unavailable, discovery still runs, just without
     * Rust verbose logs.
     */
    discoveryVerbose?: boolean;
    /**
     * Optional WASM activation bootstrap payload.
     *
     * When provided, the worker will synchronously initialise the WASM
     * activation module during startup, ensuring worker-side scoring/training
     * uses the same WASM activation implementation as the main thread.
     */
    wasmActivation?: WasmActivationInitPayload;
  };
  /** Creature evaluation request */
  evaluate?: {
    /** JSON string representation of the creature */
    creature: string;
    /** Whether to use feedback loop evaluation */
    feedbackLoop: boolean;
  };
  /** Creature training request */
  train?: {
    /** JSON string representation of the creature */
    creature: string;
    /** Training configuration options */
    options: TrainOptions;
  };
  /** Echo request for testing worker communication */
  echo?: {
    /** Message to echo back */
    message: string;
    /** Duration to wait before responding */
    ms: number;
  };
  /** Creature discovery request */
  discover?: {
    /** JSON string representation of the creature */
    creature: string;
    /** NEAT configuration (frozen, concrete values) */
    config: NeatConfig;
  };
  /** Creature breeding request (Issue #1026) */
  breed?: {
    /** JSON string representation of the mother creature */
    mother: string;
    /** JSON string representation of the father creature */
    father: string;
    /** Genetic compatibility threshold for crossover */
    geneticCompatibilityThreshold: number;
    /** Whether to create forward-only offspring */
    forwardOnly: boolean;
  };
}

/**
 * Data structure for responses received from workers.
 *
 * Defines the format of messages sent from worker threads back to the main thread
 * containing results of various operations.
 */
export interface ResponseData {
  /** Unique identifier for the task */
  taskID: number;
  /** Debug flag for verbose logging */
  debug?: boolean;
  /** Duration of the operation in milliseconds */
  duration: number;
  /** Initialization response */
  initialize?: {
    /** Status of the initialization */
    status: string;
    /** Error message when status is not OK (Issue #1260) */
    error?: string;
  };
  /** Evaluation response */
  evaluate?: {
    /** Error value from the evaluation */
    error: number;
  };
  /** Training response */
  train?: {
    /** Unique identifier for the training session */
    ID: string;
    /** JSON string representation of the trained creature */
    creature: string;
    /** Error value after training */
    error: number;
    /** JSON string representation of the trace data */
    trace: string;
    /** Optional compact creature representation */
    compact?: string;
    /** Optional backtracked creature representation */
    backtracked?: string;
    /** Optional forward creature representation */
    forward?: string;
  };
  /** Echo response */
  echo?: {
    /** Echoed message */
    message: string;
  };
  /** Discovery response */
  discover?: {
    /** Unique identifier for the discovery session */
    ID: string;
    /** Optional helpful synapses to add */
    addHelpfulSynapses?: CandidateSynapse[];
    /** Optional helpful neurons to add */
    addHelpfulNeurons?: CandidateNeuron[];
    /**
     * Optional coordinated structural candidates (epistatic groups).
     *
     * These are ordered multi-op candidates emitted by the Rust discovery
     * engine. They must be applied together to have a chance of improving
     * fitness.
     */
    coordinatedStructuralCandidates?: CoordinatedStructuralCandidate[];
    /** Optional harmful synapse to remove */
    removeHarmfulSynapse?: CandidateSynapse;
    /** Optional harmful neurons to remove */
    removeHarmfulNeurons?: CandidateHarmfulNeuron[];
    /** Optional low-impact neurons to remove (from Rust focus ranking) */
    removalCandidates?: RemovalCandidate[];
    /** Optional candidate activation functions */
    candidateSquashes?: CandidateSquash[];
    /** Time spent re-scoring candidates (ms) - set by DiscoveryRunner after evaluation */
    reScoringTime?: number;
    /**
     * Issue #1020: Improved creature JSON for direct addition to population.
     *
     * When discovery finds an improvement, the improved creature is included here
     * so it can be added directly to the population without applying changes to
     * the current fittest (which may have evolved during the discovery process).
     */
    improvedCreature?: CreatureExport;
  };
  /** Breeding response (Issue #1026) */
  breed?: {
    /** JSON string representation of the offspring creature (undefined if breeding failed) */
    offspring?: string;
    /** Whether breeding succeeded */
    success: boolean;
  };
}

interface WorkerEventListener {
  (worker: WorkerHandler): void;
}

/**
 * Interface for worker implementations.
 *
 * Defines the contract that worker implementations must follow,
 * whether they are actual Web Workers or mock implementations.
 */
export interface WorkerInterface {
  /**
   * Adds an event listener to the worker.
   *
   * @param type - Type of event to listen for
   * @param listener - Event listener function
   * @param options - Optional event listener options
   */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  /**
   * Sends a message to the worker.
   *
   * @param data - Data to send to the worker
   */
  postMessage(data: RequestData, transfer?: Transferable[]): void;

  /**
   * Terminates the worker.
   */
  terminate(): void;
}

let globalWorkerID = 0;

let cachedWasmActivationInitPayload: WasmActivationInitPayload | null = null;
let inFlightWasmActivationPayload:
  | { promise: Promise<WasmActivationInitPayload> }
  | null = null;

/**
 * Get the default WASM activation directory path.
 *
 * @returns The path to the WASM activation pkg directory
 */
/**
 * Load the WASM activation payload from the canonical package location.
 *
 * Issue #1206 - Returns null if the WASM files are not available.
 *
 * @returns The WASM activation payload, or null if not available
 */
export function loadWasmActivationInitPayload():
  | WasmActivationInitPayload
  | null {
  try {
    if (cachedWasmActivationInitPayload) return cachedWasmActivationInitPayload;
    const baseUrl = new URL("../../../wasm_activation/pkg/", import.meta.url);
    // Sync loader only supports filesystem reads (local checkouts).
    if (baseUrl.protocol !== "file:") return null;
    const jsSource = Deno.readTextFileSync(
      new URL("wasm_activation.js", baseUrl).pathname,
    );
    const wasmBinary = Deno.readFileSync(
      new URL("wasm_activation_bg.wasm", baseUrl).pathname,
    );
    cachedWasmActivationInitPayload = { jsSource, wasmBinary };
    return cachedWasmActivationInitPayload;
  } catch {
    return null;
  }
}

/**
 * Async variant of loadWasmActivationInitPayload() that supports JSR `https:` URLs.
 */
export async function loadWasmActivationInitPayloadAsync(): Promise<
  WasmActivationInitPayload
> {
  if (cachedWasmActivationInitPayload) return cachedWasmActivationInitPayload;
  if (inFlightWasmActivationPayload) {
    return await inFlightWasmActivationPayload.promise;
  }

  const promise = (async () => {
    const baseUrl = new URL("../../../wasm_activation/pkg/", import.meta.url);
    const jsUrl = new URL("wasm_activation.js", baseUrl);
    const wasmUrl = new URL("wasm_activation_bg.wasm", baseUrl);

    let jsSource: string;
    let wasmBinary: Uint8Array;

    if (baseUrl.protocol === "file:") {
      jsSource = await Deno.readTextFile(jsUrl.pathname);
      wasmBinary = await Deno.readFile(wasmUrl.pathname);
    } else {
      const [jsRes, wasmRes] = await Promise.all([
        fetch(jsUrl.href),
        fetch(wasmUrl.href),
      ]);
      if (!jsRes.ok || !wasmRes.ok) {
        const jsErr = !jsRes.ok
          ? `${jsUrl.href}: ${jsRes.status} ${jsRes.statusText}`
          : null;
        const wasmErr = !wasmRes.ok
          ? `${wasmUrl.href}: ${wasmRes.status} ${wasmRes.statusText}`
          : null;
        throw new Error(
          `WASM activation payload could not be loaded. ${
            [jsErr, wasmErr].filter(Boolean).join("; ")
          }`,
        );
      }
      jsSource = await jsRes.text();
      wasmBinary = new Uint8Array(await wasmRes.arrayBuffer());
    }

    cachedWasmActivationInitPayload = { jsSource, wasmBinary };
    return cachedWasmActivationInitPayload;
  })().finally(() => {
    inFlightWasmActivationPayload = null;
  });

  inFlightWasmActivationPayload = { promise };
  return await promise;
}

/**
 * Prefetch WASM activation in the main thread for use by workers.
 *
 * Issue #1285: Call this before spawning workers (e.g. GRQ training, portfolio,
 * IntelligentDesign) so the main thread does one fetch and workers receive the
 * cached payload instead of each worker triggering its own fetch. Avoids
 * timeouts and duplicate work when many workers start at once.
 *
 * @returns Promise that resolves when the WASM payload is loaded and cached
 */
export async function fetchWasmForWorkers(): Promise<void> {
  await loadWasmActivationInitPayloadAsync();
}

/**
 * Check if the WASM activation payload is available.
 *
 * Issue #1206 - Provides a way to check WASM availability without loading
 * the full payload.
 * @returns True if the WASM files are available, false otherwise
 */
export function isWasmActivationPayloadAvailable(): boolean {
  try {
    const baseUrl = new URL("../../../wasm_activation/pkg/", import.meta.url);
    if (baseUrl.protocol !== "file:") return true; // published bundles are fetchable
    const jsStat = Deno.statSync(
      new URL("wasm_activation.js", baseUrl).pathname,
    );
    const wasmStat = Deno.statSync(
      new URL("wasm_activation_bg.wasm", baseUrl).pathname,
    );
    return jsStat.isFile && wasmStat.isFile;
  } catch {
    return false;
  }
}

/**
 * Manages communication with worker threads for parallel processing.
 *
 * This class handles the creation, communication, and lifecycle management
 * of worker threads used for evaluating, training, and discovering creatures
 * in parallel. It supports both real Web Workers and mock implementations.
 *
 * Key features:
 * - Asynchronous task execution
 * - Promise-based communication
 * - Busy state tracking
 * - Idle event notifications
 * - Error handling
 *
 * @example
 * ```ts
 * const worker = new WorkerHandler("./data", "MSE", false);
 * const result = await worker.evaluate(creature, false);
 * getLogger().info(`Evaluation error: ${result.evaluate?.error}`);
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
  /** Captured worker error during initialization (if any). */
  private initWorkerError?: Error;

  /**
   * Creates a new WorkerHandler instance.
   *
   * @param dataSetDir - Directory containing the dataset
   * @param costName - Name of the cost function to use
   * @param direct - Whether to use direct (mock) worker or Web Worker
   */
  constructor(
    dataSetDir: string,
    costName: CostName,
    direct: boolean,
    customCost?: { filePath: string },
  ) {
    let rejectInitError: ((err: Error) => void) | null = null;
    const initErrorPromise: Promise<never> = new Promise((_, reject) => {
      rejectInitError = reject;
    });

    let customCostData: string | undefined;
    if (customCost) {
      // File path-based custom cost
      customCostData = JSON.stringify({
        filePath: customCost.filePath,
      });
    }

    const discoveryVerbose = (() => {
      try {
        const value = Deno.env.get("NEAT_AI_DISCOVERY_VERBOSE");
        if (!value) return false;
        const normalised = value.trim().toLowerCase();
        return normalised === "1" || normalised === "true" ||
          normalised === "yes";
      } catch {
        return false;
      }
    })();

    // Issue #1263: WASM activation is mandatory.
    if (!direct) {
      const workerUrl = new URL("./deno/worker.ts", import.meta.url).href;
      this.worker = new Worker(
        workerUrl,
        {
          type: "module",
          name: "worker-" + this.workerID,
        },
      );
      const captureInitError = (err: Error) => {
        // Store first init error for diagnostics; ignore later ones.
        if (!this.initWorkerError) this.initWorkerError = err;
        // Fail fast for init callers.
        rejectInitError?.(err);
        rejectInitError = null;
      };
      this.worker.addEventListener("error", (e) => {
        const ev = e as ErrorEvent;
        const msg = [
          `Worker error event during init (workerID=${this.workerID})`,
          `script=${workerUrl}`,
          ev.message ? `message=${ev.message}` : null,
          ev.filename ? `file=${ev.filename}:${ev.lineno}:${ev.colno}` : null,
        ].filter(Boolean).join(" | ");
        const err = new Error(msg, { cause: ev.error });
        captureInitError(err);
        getLogger().error(msg, ev.error ?? ev);
      });
      this.worker.addEventListener("messageerror", (e) => {
        const msg =
          `Worker messageerror event during init (workerID=${this.workerID}) | script=${workerUrl}`;
        const err = new Error(msg, { cause: e });
        captureInitError(err);
        getLogger().error(msg, e);
      });
    } else {
      this.worker = new MockWorker();
    }

    this.worker.addEventListener("message", (message) => {
      const me = message as MessageEvent;

      this.callback(me.data as ResponseData);
    });

    // Worker init is async so we can load WASM payload for both local and JSR URLs.
    // Issue #1260: Timeout so we fail fast if worker never responds (e.g. worker crash on init).
    // Production with many workers (e.g. 28+): set NEAT_AI_WORKER_INIT_TIMEOUT_MS if init is slow.
    const INIT_RESPONSE_TIMEOUT_MS = (() => {
      try {
        const v = Deno.env.get("NEAT_AI_WORKER_INIT_TIMEOUT_MS");
        // Default is intentionally generous to handle first-run JSR/WASM cache warmup.
        if (v === null || v === undefined || v === "") return 60_000;
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n >= 1000 ? n : 60_000;
      } catch {
        return 60_000;
      }
    })();
    this.ready = (async () => {
      const wasmPayload = await loadWasmActivationInitPayloadAsync();
      const data: RequestData = {
        taskID: this.taskID++,
        initialize: {
          dataSetDir: dataSetDir,
          costName: costName,
          customCostData,
          discoveryVerbose,
          wasmActivation: wasmPayload,
        },
      };

      const initSequence = async (): Promise<ResponseData> =>
        await new Promise<ResponseData>((resolve, reject) => {
          const timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  `Worker init: no response after ${
                    INIT_RESPONSE_TIMEOUT_MS / 1000
                  }s. Worker may have crashed or be stuck loading WASM.${
                    this.initWorkerError
                      ? ` First worker error: ${this.initWorkerError.message}`
                      : ""
                  }`,
                ),
              ),
            INIT_RESPONSE_TIMEOUT_MS,
          );
          this.makePromise(data).then(
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

      const result = await Promise.race([
        initSequence(),
        initErrorPromise,
      ]);
      // Init complete: do not allow init error to affect anything else.
      rejectInitError = null;
      assert(
        result.initialize?.status === "OK",
        result.initialize?.error ?? "Worker initialization failed",
      );
      return result;
    })();
  }

  /**
   * Wait until the worker has completed initialization.
   *
   * Useful for callers that want to avoid a "download storm" when spinning up
   * many workers from a cold cache (e.g. JSR + WASM payloads).
   */
  waitUntilReady(): Promise<void> {
    return this.ready.then(() => undefined);
  }

  /**
   * Checks if the worker is currently busy with tasks.
   *
   * @returns True if the worker has pending tasks, false otherwise
   */
  isBusy() {
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

    // Log discovery response receipt
    if (data.discover) {
      getLogger().info(
        `[WorkerHandler] Received discovery response for taskID: ${data.taskID}`,
      );
    }

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

    // Log discovery request posting
    if (data.discover) {
      getLogger().info(
        `[WorkerHandler] Posting discovery request to worker (taskID: ${data.taskID})`,
      );
    }

    // Note: we intentionally do NOT transfer the wasm ArrayBuffer here, because
    // this initialization payload is cached and reused for multiple workers.
    this.worker.postMessage(data);

    return p;
  }

  /**
   * Creates a promise for a request that is deferred until the worker is ready.
   *
   * Unlike `makePromise`, this method increments `busyCount` immediately so that
   * `isBusy()` reflects queued work even while the worker is still initializing.
   * The actual message is posted only after `this.ready` resolves.
   *
   * @param data - The request data to send
   * @returns Promise resolving to the worker's response
   */
  private makePromiseDeferred(data: RequestData): Promise<ResponseData> {
    // Increment busyCount immediately so isBusy() reflects pending work.
    this.busyCount++;

    const p = new Promise<ResponseData>((resolve, reject) => {
      const call = (result: ResponseData) => {
        this.busyCount--;

        resolve(result);

        if (!this.isBusy()) {
          this.idleListeners.forEach((listener) => listener(this));
        }
      };

      this.callbacks.set(data.taskID, call);

      // Wait for initialization before posting the message.
      this.ready.then(() => {
        // Log discovery request posting
        if (data.discover) {
          getLogger().info(
            `[WorkerHandler] Posting discovery request to worker (taskID: ${data.taskID})`,
          );
        }

        this.worker.postMessage(data);
      }).catch((err) => {
        // Initialization failed; clean up and reject.
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

  terminate() {
    // Clear all pending callbacks to prevent memory leaks
    this.callbacks.clear();
    this.idleListeners.length = 0;
    this.worker.terminate();
  }

  echo(message: string, ms: number) {
    const data: RequestData = {
      taskID: this.taskID++,
      echo: {
        message: message,
        ms: ms,
      },
    };

    return this.makePromiseDeferred(data);
  }

  evaluate(creature: Creature, feedbackLoop: boolean) {
    const data: RequestData = {
      taskID: this.taskID++,
      evaluate: {
        creature: JSON.stringify(creature.exportJSON()),
        feedbackLoop,
      },
    };

    return this.makePromiseDeferred(data);
  }

  train(creature: Creature, options: TrainOptions) {
    const json = creature.exportJSON();

    delete json.tags;

    addTag(
      json,
      "untrained-error",
      `${getTag(creature, "error")}`,
    );
    addTag(
      json,
      "untrained-score",
      `${creature.score}`,
    );

    const data: RequestData = {
      taskID: this.taskID++,
      train: {
        creature: JSON.stringify(json),
        options: options,
      },
    };

    // Immediately clear the large JSON object to help GC
    // @ts-ignore - clearing to help GC
    json.tags = null;
    // @ts-ignore - clearing to help GC
    json.neurons = null;
    // @ts-ignore - clearing to help GC
    json.synapses = null;

    return this.makePromiseDeferred(data);
  }

  discover(creature: Creature, config: NeatConfig) {
    const json = creature.exportJSON();

    // Strip non-cloneable properties so postMessage structured clone succeeds.
    // Workers use getLogger() and getRandomNumberGenerator() set during init.
    const configForWorker = { ...config } as Record<string, unknown>;
    delete configForWorker.logger;
    delete configForWorker.rng;

    const data: RequestData = {
      taskID: this.taskID++,
      discover: {
        creature: JSON.stringify(json),
        config: configForWorker as NeatConfig,
      },
    };

    // Immediately clear the large JSON object to help GC
    // @ts-ignore - clearing to help GC
    json.neurons = null;
    // @ts-ignore - clearing to help GC
    json.synapses = null;

    return this.makePromiseDeferred(data);
  }

  /**
   * Breeds two creatures to produce offspring.
   *
   * Issue #1026: Parallelise breeding loop using worker pool.
   *
   * @param mother - The mother creature
   * @param father - The father creature
   * @param geneticCompatibilityThreshold - Threshold for genetic compatibility
   * @param forwardOnly - Whether to create forward-only offspring
   * @returns Promise resolving to the response data
   */
  breed(
    mother: Creature,
    father: Creature,
    geneticCompatibilityThreshold: number,
    forwardOnly: boolean,
  ) {
    const motherJson = mother.exportJSON();
    const fatherJson = father.exportJSON();

    const data: RequestData = {
      taskID: this.taskID++,
      breed: {
        mother: JSON.stringify(motherJson),
        father: JSON.stringify(fatherJson),
        geneticCompatibilityThreshold,
        forwardOnly,
      },
    };

    // Immediately clear large JSON objects to help GC
    // @ts-ignore - clearing to help GC
    motherJson.neurons = null;
    // @ts-ignore - clearing to help GC
    motherJson.synapses = null;
    // @ts-ignore - clearing to help GC
    fatherJson.neurons = null;
    // @ts-ignore - clearing to help GC
    fatherJson.synapses = null;

    return this.makePromiseDeferred(data);
  }
}
