import { assert } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import type { CostName } from "@costs";
import type { Creature } from "@creature";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import type {
  CoordinatedStructuralCandidate,
} from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import type { RemovalCandidate } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import type { WasmCacheConfig } from "@config/WasmCacheConfig.ts";
import { getLogger } from "@utils/Logger.ts";
import {
  getInitTimeoutMs,
  WorkerHandlerBase,
} from "@workers/WorkerHandlerBase.ts";
import type { WorkerInterface } from "@workers/WorkerInterface.ts";
import {
  loadWasmActivationInitPayloadAsync,
} from "@workers/WasmActivationPayload.ts";
import { isWasmActivationAvailable } from "@wasm/mod.ts";
import { MockWorker } from "@multithreading/workers/MockWorker.ts";

// Re-export shared types for backwards compatibility.
export type {
  WasmActivationInitPayload,
} from "@workers/WasmActivationPayload.ts";
export {
  fetchWasmForWorkers,
  isWasmActivationPayloadAvailable,
  loadWasmActivationInitPayload,
  loadWasmActivationInitPayloadAsync,
} from "@workers/WasmActivationPayload.ts";

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
    /**
     * Issue #1620: Optional per-output range constraints.
     *
     * When provided, the worker applies an additive penalty to the
     * evaluation error for outputs that fall outside the specified ranges.
     */
    outputRanges?: ReadonlyArray<RequiredOutputRange>;
  };
  /** Creature evaluation request */
  evaluate?: {
    /** Exported creature data for evaluation */
    creature: CreatureExport;
    /** Whether to use feedback loop evaluation */
    feedbackLoop: boolean;
  };
  /** Creature training request */
  train?: {
    /** Exported creature data for training */
    creature: CreatureExport;
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
    /** Exported creature data for discovery */
    creature: CreatureExport;
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
    /** Exported mother creature data */
    mother: CreatureExport;
    /** Exported father creature data */
    father: CreatureExport;
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
  /**
   * Error details when the worker failed to process the request.
   *
   * Issue #1761: Standardised error field consistent with the intelligent
   * design worker, preserving error name, message, and stack trace.
   */
  error?: {
    /** Error name (when available) */
    name?: string;
    /** Error message */
    message: string;
    /** Stack trace (when available) */
    stack?: string;
  };
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
    /** Exported trained creature data */
    creature: CreatureExport;
    /** Error value after training */
    error: number;
    /** Trace data from training */
    trace: CreatureTrace;
    /** Optional compact creature representation */
    compact?: CreatureExport;
    /** Optional backtracked creature representation */
    backtracked?: CreatureExport;
    /** Optional forward creature representation */
    forward?: CreatureExport;
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
    /** Exported offspring creature data (undefined if breeding failed) */
    offspring?: CreatureExport;
    /** Whether breeding succeeded */
    success: boolean;
  };
}

// Re-export WorkerInterface for backwards compatibility.
export type { WorkerInterface } from "@workers/WorkerInterface.ts";

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
   * @param outputRanges - Issue #1620: Optional per-output range constraints for fitness penalty
   */
  constructor(
    dataSetDir: string,
    costName: CostName,
    direct: boolean,
    customCost?: { filePath: string },
    wasmCache?: WasmCacheConfig,
    outputRanges?: ReadonlyArray<RequiredOutputRange>,
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
      // Issue #2112: Gracefully handle WASM payload load failure.
      // For direct/mock workers the main thread's WASM is shared, so
      // a missing payload is non-fatal when WASM is already loaded.
      let wasmPayload:
        | import("../../workers/WasmActivationPayload.ts").WasmActivationInitPayload
        | undefined;
      try {
        wasmPayload = await loadWasmActivationInitPayloadAsync();
      } catch (wasmErr) {
        if (direct && isWasmActivationAvailable()) {
          getLogger().warn(
            "[WorkerHandler] WASM payload load failed but WASM is available in the main thread; proceeding without payload for direct worker.",
          );
        } else {
          throw wasmErr;
        }
      }
      const data: RequestData = {
        taskID: this.taskID++,
        initialize: {
          dataSetDir: dataSetDir,
          costName: costName,
          customCostData,
          discoveryVerbose,
          wasmActivation: wasmPayload,
          wasmCache,
          outputRanges: outputRanges && outputRanges.length > 0
            ? outputRanges
            : undefined,
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
        creature: creature.exportJSON(),
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
        creature: json,
        options: options,
      },
    };

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
        creature: json,
        config: configForWorker as NeatConfig,
      },
    };

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
        mother: motherJson,
        father: fatherJson,
        geneticCompatibilityThreshold,
        forwardOnly,
      },
    };

    return this.makePromiseDeferred(data);
  }
}
