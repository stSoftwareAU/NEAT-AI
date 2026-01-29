import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import type { CostName } from "../../Costs.ts";
import type { Creature } from "../../Creature.ts";
import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { RemovalCandidate } from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  CoordinatedStructuralCandidate,
} from "../../architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import type { NeatConfig } from "../../config/NeatConfig.ts";
import type { TrainOptions } from "../../config/TrainOptions.ts";
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
let cachedWasmPath: string | null = null;

/**
 * Issue #1229: WASM is required by default with no fallback.
 * Set NEAT_AI_USE_JS_ACTIVATION=1 to allow workers without WASM (verification only).
 */
function shouldRequireWasmActivation(): boolean {
  try {
    const useJs = Deno.env.get("NEAT_AI_USE_JS_ACTIVATION")?.trim()
      .toLowerCase();
    if (
      useJs === "1" || useJs === "true" || useJs === "yes" || useJs === "on"
    ) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Get the default WASM activation directory path.
 *
 * @returns The path to the WASM activation pkg directory
 */
function getDefaultWasmPath(): string {
  // Default to a filesystem path for local checkouts.
  // Note: When running from `https:` (JSR), this is not a valid filesystem path.
  // Consumers should prefer loadWasmActivationInitPayloadAsync() in that case.
  return new URL("../../../wasm_activation/pkg/", import.meta.url).pathname
    .replace(/\/$/, "");
}

type ResolvedWasmLocation =
  | { kind: "path"; key: string; basePath: string }
  | { kind: "url"; key: string; baseUrl: URL };

function resolveWasmLocation(wasmPath?: string): ResolvedWasmLocation {
  if (!wasmPath) {
    const baseUrl = new URL("../../../wasm_activation/pkg/", import.meta.url);
    return { kind: "url", key: baseUrl.href, baseUrl };
  }

  // Accept both URL strings (file/http/https) and raw filesystem paths.
  try {
    const u = new URL(wasmPath);
    const baseUrl = u.href.endsWith("/") ? u : new URL(`${u.href}/`);
    return { kind: "url", key: baseUrl.href, baseUrl };
  } catch {
    const basePath = wasmPath.replace(/\/$/, "");
    return { kind: "path", key: basePath, basePath };
  }
}

/**
 * Load the WASM activation payload from the specified path.
 *
 * Issue #1206 - Returns null if the WASM files are not available,
 * allowing graceful fallback to JavaScript-based activation.
 *
 * @param wasmPath - Optional path to the WASM pkg directory. Defaults to the
 *                   project's wasm_activation/pkg directory.
 * @returns The WASM activation payload, or null if not available
 */
export function loadWasmActivationInitPayload(
  wasmPath?: string,
): WasmActivationInitPayload | null {
  const targetPath = wasmPath ?? getDefaultWasmPath();

  // Return cached payload if available and path matches
  if (cachedWasmActivationInitPayload && cachedWasmPath === targetPath) {
    return cachedWasmActivationInitPayload;
  }

  try {
    const jsSource = Deno.readTextFileSync(`${targetPath}/wasm_activation.js`);
    const wasmBinary = Deno.readFileSync(
      `${targetPath}/wasm_activation_bg.wasm`,
    );

    // Cache for the default path only
    if (!wasmPath) {
      cachedWasmActivationInitPayload = {
        jsSource,
        wasmBinary,
      };
      cachedWasmPath = targetPath;
      return cachedWasmActivationInitPayload;
    }

    return {
      jsSource,
      wasmBinary,
    };
  } catch {
    return null;
  }
}

/**
 * Async variant of loadWasmActivationInitPayload() that supports JSR `https:` URLs.
 *
 * This is required for consumers running from `jsr.io` where `wasm_activation/pkg`
 * files are addressed via `https://...` and cannot be read using Deno filesystem APIs.
 */
export async function loadWasmActivationInitPayloadAsync(
  wasmPath?: string,
): Promise<WasmActivationInitPayload | null> {
  const resolved = resolveWasmLocation(wasmPath);

  // Return cached payload if available and path matches
  if (cachedWasmActivationInitPayload && cachedWasmPath === resolved.key) {
    return cachedWasmActivationInitPayload;
  }

  try {
    let jsSource: string;
    let wasmBinary: Uint8Array;

    if (resolved.kind === "path") {
      jsSource = await Deno.readTextFile(
        `${resolved.basePath}/wasm_activation.js`,
      );
      wasmBinary = await Deno.readFile(
        `${resolved.basePath}/wasm_activation_bg.wasm`,
      );
    } else {
      const jsUrl = new URL("wasm_activation.js", resolved.baseUrl);
      const wasmUrl = new URL("wasm_activation_bg.wasm", resolved.baseUrl);

      if (resolved.baseUrl.protocol === "file:") {
        jsSource = await Deno.readTextFile(jsUrl.pathname);
        wasmBinary = await Deno.readFile(wasmUrl.pathname);
      } else {
        const [jsRes, wasmRes] = await Promise.all([
          fetch(jsUrl.href),
          fetch(wasmUrl.href),
        ]);
        if (!jsRes.ok || !wasmRes.ok) return null;
        jsSource = await jsRes.text();
        wasmBinary = new Uint8Array(await wasmRes.arrayBuffer());
      }
    }

    // Cache for default location only (no explicit wasmPath)
    if (!wasmPath) {
      cachedWasmActivationInitPayload = { jsSource, wasmBinary };
      cachedWasmPath = resolved.key;
      return cachedWasmActivationInitPayload;
    }

    return { jsSource, wasmBinary };
  } catch {
    return null;
  }
}

/**
 * Check if the WASM activation payload is available.
 *
 * Issue #1206 - Provides a way to check WASM availability without loading
 * the full payload.
 *
 * @param wasmPath - Optional path to the WASM pkg directory
 * @returns True if the WASM files are available, false otherwise
 */
export function isWasmActivationPayloadAvailable(wasmPath?: string): boolean {
  const targetPath = wasmPath ?? getDefaultWasmPath();

  try {
    const jsStat = Deno.statSync(`${targetPath}/wasm_activation.js`);
    const wasmStat = Deno.statSync(`${targetPath}/wasm_activation_bg.wasm`);
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
 * console.log(`Evaluation error: ${result.evaluate?.error}`);
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

    // Issue #1229: WASM is required by default. When shouldRequireWasmActivation()
    // is true, missing WASM payload throws below. Set NEAT_AI_USE_JS_ACTIVATION=1
    // for verification only.
    if (!direct) {
      this.worker = new Worker(
        new URL("./deno/worker.ts", import.meta.url).href,
        {
          type: "module",
          name: "worker-" + this.workerID,
        },
      );
      this.worker.addEventListener("error", (e) => {
        console.error("Worker error event:", e);
      });
      this.worker.addEventListener("messageerror", (e) => {
        console.error("Worker message error event:", e);
      });
    } else {
      this.worker = new MockWorker();
    }

    this.worker.addEventListener("message", (message) => {
      const me = message as MessageEvent;

      this.callback(me.data as ResponseData);
    });

    // Worker init is async so we can load WASM payload for both local and JSR URLs.
    this.ready = (async () => {
      const wasmPayload = await loadWasmActivationInitPayloadAsync();
      if (shouldRequireWasmActivation() && !wasmPayload) {
        throw new Error(
          "WASM activation is required but wasm_activation/pkg could not be loaded. " +
            "Ensure the published package includes wasm_activation/pkg or build it locally. " +
            "For verification only, set NEAT_AI_USE_JS_ACTIVATION=1.",
        );
      }
      const data: RequestData = {
        taskID: this.taskID++,
        initialize: {
          dataSetDir: dataSetDir,
          costName: costName,
          customCostData,
          discoveryVerbose,
          wasmActivation: wasmPayload ?? undefined,
        },
      };

      const result = await this.makePromise(data);
      assert(
        result.initialize?.status === "OK",
        "Worker initialization failed",
      );
      return result;
    })();
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
      console.log(
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
      console.log(
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
          console.log(
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

    const data: RequestData = {
      taskID: this.taskID++,
      discover: {
        creature: JSON.stringify(json),
        config: config,
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
