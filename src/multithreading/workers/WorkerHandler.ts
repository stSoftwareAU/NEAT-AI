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
import type { WasmCacheConfig } from "../../config/WasmCacheConfig.ts";
import { getLogger } from "../../utils/Logger.ts";
import {
  getInitTimeoutMs,
  WorkerHandlerBase,
} from "../../workers/WorkerHandlerBase.ts";
import type { WorkerInterface } from "../../workers/WorkerInterface.ts";
import {
  loadWasmActivationInitPayloadAsync,
} from "../../workers/WasmActivationPayload.ts";
import { MockWorker } from "./MockWorker.ts";

// Re-export shared types for backwards compatibility.
export type {
  WasmActivationInitPayload,
} from "../../workers/WasmActivationPayload.ts";
export {
  fetchWasmForWorkers,
  isWasmActivationPayloadAvailable,
  loadWasmActivationInitPayload,
  loadWasmActivationInitPayloadAsync,
} from "../../workers/WasmActivationPayload.ts";

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
    wasmActivation?:
      import("../../workers/WasmActivationPayload.ts").WasmActivationInitPayload;
    /**
     * Issue #1567: Optional WASM cache configuration to apply at startup.
     *
     * When provided, the worker will set its LRU cache caps to match the
     * main thread configuration, preventing mismatches between main-thread
     * and worker-side cache sizing.
     */
    wasmCache?: WasmCacheConfig;
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
  /**
   * Issue #1567: Dynamically update WASM cache caps in a running worker.
   *
   * Allows the main thread to reduce cache limits under memory pressure
   * without restarting workers.
   */
  configureCache?: WasmCacheConfig;
  /**
   * Issue #1567: Request current cache statistics from the worker.
   *
   * When true, the worker responds with its current cache occupancy
   * and configured limits, giving the main thread visibility into
   * worker-side memory consumption.
   */
  requestCacheStats?: boolean;
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
  /**
   * Issue #1567: Response after applying cache configuration.
   */
  configureCache?: {
    /** Status of the configuration change */
    status: string;
  };
  /**
   * Issue #1567: Worker cache statistics response.
   */
  cacheStats?: {
    /** Current number of entries in the activation LRU cache */
    activationCacheCount: number;
    /** Configured maximum for activation LRU cache */
    activationCacheMax: number;
    /** Current number of entries in the compilation cache */
    compilationCacheSize: number;
    /** Configured maximum for compilation cache */
    compilationCacheMax: number;
  };
  /** Breeding response (Issue #1026) */
  breed?: {
    /** JSON string representation of the offspring creature (undefined if breeding failed) */
    offspring?: string;
    /** Whether breeding succeeded */
    success: boolean;
  };
}

// Re-export WorkerInterface for backwards compatibility.
export type { WorkerInterface } from "../../workers/WorkerInterface.ts";

/**
 * Manages communication with worker threads for parallel processing.
 *
 * Extends WorkerHandlerBase for shared lifecycle management (Issue #1600).
 *
 * @example
 * ```ts
 * const worker = new WorkerHandler("./data", "MSE", false);
 * const result = await worker.evaluate(creature, false);
 * getLogger().info(`Evaluation error: ${result.evaluate?.error}`);
 * ```
 */
export class WorkerHandler
  extends WorkerHandlerBase<RequestData, ResponseData> {
  /**
   * Creates a new WorkerHandler instance.
   *
   * @param dataSetDir - Directory containing the dataset
   * @param costName - Name of the cost function to use
   * @param direct - Whether to use direct (mock) worker or Web Worker
   * @param customCost - Optional custom cost function file path
   * @param wasmCache - Issue #1567: Optional WASM cache configuration to propagate to the worker
   */
  constructor(
    dataSetDir: string,
    costName: CostName,
    direct: boolean,
    customCost?: { filePath: string },
    wasmCache?: WasmCacheConfig,
  ) {
    let rejectInitError: ((err: Error) => void) | null = null;
    const initErrorPromise: Promise<never> = new Promise((_, reject) => {
      rejectInitError = reject;
    });

    let customCostData: string | undefined;
    if (customCost) {
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

    const workerUrl = new URL("./deno/worker.ts", import.meta.url).href;

    // Temporary variable for initWorkerError capture before super() completes.
    let capturedInitError: Error | undefined;
    const onInitError = (err: Error) => {
      if (!capturedInitError) capturedInitError = err;
      rejectInitError?.(err);
      rejectInitError = null;
    };

    const worker = WorkerHandlerBase.createWorkerOrMock<RequestData>(
      direct,
      workerUrl,
      "worker-" + (++WorkerHandler.nextWorkerIDForConstruction),
      () => new MockWorker() as unknown as WorkerInterface<RequestData>,
      onInitError,
    );

    const INIT_RESPONSE_TIMEOUT_MS = getInitTimeoutMs();

    // Build init ready promise via deferred pattern since super() must be
    // called before we can use `this`.
    let resolveInitReady!: (value: ResponseData) => void;
    let rejectInitReady!: (err: Error) => void;
    const initReady = new Promise<ResponseData>((resolve, reject) => {
      resolveInitReady = resolve;
      rejectInitReady = reject;
    });

    super(worker, initReady);

    // Transfer captured init error.
    this.initWorkerError = capturedInitError;

    // Now perform async initialisation.
    (async () => {
      const wasmPayload = await loadWasmActivationInitPayloadAsync();
      const data: RequestData = {
        taskID: this.taskID++,
        initialize: {
          dataSetDir: dataSetDir,
          costName: costName,
          customCostData,
          discoveryVerbose,
          wasmActivation: wasmPayload,
          wasmCache,
        },
      };

      const result = await this.createInitSequence(
        data,
        initErrorPromise,
        INIT_RESPONSE_TIMEOUT_MS,
      );
      // Init complete: do not allow init error to affect anything else.
      rejectInitError = null;
      assert(
        result.initialize?.status === "OK",
        result.initialize?.error ?? "Worker initialization failed",
      );
      return result;
    })().then(resolveInitReady, rejectInitReady);
  }

  /** Static counter used during construction (before super assigns workerID). */
  private static nextWorkerIDForConstruction = 0;

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

    getLogger().info(
      `[WorkerHandler] Posting discovery request to worker (taskID: ${data.taskID})`,
    );

    return this.makePromiseDeferred(data);
  }

  /**
   * Dynamically update WASM cache caps in the worker.
   *
   * Issue #1567: Allows the main thread to adjust worker cache limits
   * at runtime, e.g. under memory pressure.
   *
   * @param config - Cache configuration to apply
   * @returns Promise resolving to the response data
   */
  configureCache(config: WasmCacheConfig) {
    const data: RequestData = {
      taskID: this.taskID++,
      configureCache: config,
    };

    return this.makePromiseDeferred(data);
  }

  /**
   * Request current cache statistics from the worker.
   *
   * Issue #1567: Gives the main thread visibility into worker-side
   * cache occupancy and configured limits.
   *
   * @returns Promise resolving to the response data with cache stats
   */
  requestCacheStats() {
    const data: RequestData = {
      taskID: this.taskID++,
      requestCacheStats: true,
    };

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
