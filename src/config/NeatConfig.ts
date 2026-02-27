/**
 * NeatConfig.ts - NEAT configuration factory and constants.
 *
 * Issue #1599: Refactored from 1,120 lines into a ~500-line factory.
 * Sub-config parsing is delegated to NeatConfigParsers.ts and
 * cross-field validation to NeatConfigValidation.ts.
 */

import type { NeatOptionsInput } from "./NeatOptions.ts";
import { getGlobalDebug } from "../globalAccessors.ts";
import {
  DEFAULT_RUST_FLUSH_BYTES,
  DEFAULT_RUST_FLUSH_RECORDS,
} from "../architecture/ErrorGuidedStructuralEvolution/constants.ts";
import { Selection, type SelectionInterface } from "../methods/Selection.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import type { DiscoveryMinCandidatesPerCategory } from "./DiscoveryMinCandidatesPerCategory.ts";
import type { NeatArguments } from "./NeatArguments.ts";
import { parseDiscoverySampleRate, parseNumber } from "./ParseOptions.ts";
import {
  createConsoleLogger,
  type Logger,
  setLogger,
} from "../utils/Logger.ts";
import {
  createSeededRng,
  createUnseededRng,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "../utils/RandomNumberGenerator.ts";

import {
  DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT,
  type RequiredOutputRange,
} from "./OutputRangeConfig.ts";

// Extracted sub-config parsers
import {
  parseAdaptiveMutationThresholds,
  parseBiasRegularisation,
  parseDiscoveryMinCandidates,
  parseEnsembleDiversity,
  parseFineTunePopulation,
  parseMemoryConfig,
  parsePlateauDetection,
  parsePredictiveCoding,
  parseQuantumStep,
  parseStabilityAdaptation,
  parseWasmCache,
  parseWeightRegularisation,
  parseWorkerThreadCap,
} from "./NeatConfigParsers.ts";

// Extracted cross-field validation
import { validateNeatConfig } from "./NeatConfigValidation.ts";

/**
 * Default cost of growth value used when not specified in options.
 */
export const DEFAULT_COST_OF_GROWTH = 0.000_000_1;

/**
 * Default discovery sample rate.
 *
 * Issue #1386: Increased from 0.05 (5%) to 0.2 (20%) so that the Rust
 * discovery engine has 4x more data points to base structural decisions on.
 */
export const DEFAULT_DISCOVERY_SAMPLE_RATE = 0.2;

/**
 * Default maximum minutes allocated to the recording phase before discovery
 * advances to analysis.
 *
 * Issue #1386: Increased from 1 minute to 5 minutes to accommodate the higher
 * default sample rate.
 */
export const DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES = 5;

/**
 * Minimum allowed cost of growth value.
 */
export const MIN_COST_OF_GROWTH = 0.000_000_000_1;

/**
 * Minimum allowed discovery analysis timeout in minutes.
 */
export const MIN_ANALYSIS_TIMEOUT_MINUTES = 0.05; // 3 seconds

/**
 * Maximum allowed discovery analysis timeout in minutes.
 */
export const MAX_ANALYSIS_TIMEOUT_MINUTES = 60; // 1 hour

/**
 * Default minimum candidates per discovery category.
 */
export const DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY: Required<
  DiscoveryMinCandidatesPerCategory
> = {
  addNeurons: 1,
  addSynapses: 1,
  changeSquash: 1,
  removeLowImpact: 3,
};

/**
 * Interface for NEAT training options.
 * Provides a read-only configuration object for the NEAT algorithm.
 */
export type NeatConfig = Readonly<NeatArguments>;

/**
 * Creates a validated NEAT configuration from user options.
 *
 * @param options - Partial configuration options from the user
 * @returns A frozen, validated NEAT configuration object
 */
export function createNeatConfig(options: NeatOptionsInput): NeatConfig {
  const opts = options as Record<string, unknown>;

  // Issue #1400: Set up the global RNG before anything else uses randomness.
  const rng: RandomNumberGenerator = (() => {
    if (options.rng) return options.rng;
    const seedRaw = opts.seed;
    if (seedRaw !== undefined && seedRaw !== null) {
      const seed = parseNumber("Seed", seedRaw, 0, { min: 0 });
      return createSeededRng(seed);
    }
    return createUnseededRng();
  })();
  setRandomNumberGenerator(rng);

  let selection: SelectionInterface = Selection.POWER;
  if (options.selection) {
    selection = options.selection;
  } else {
    const r0 = rng.random();
    if (r0 < 0.33) {
      selection = Selection.FITNESS_PROPORTIONATE;
    } else if (r0 < 0.66) {
      selection = Selection.TOURNAMENT;
    }
  }

  const defaultThreads = Math.max(1, navigator.hardwareConcurrency ?? 1);
  let threads = parseNumber("Threads", opts.threads, defaultThreads, {
    integer: true,
    min: 1,
  });

  // Issue #1569: Parse worker thread cap config and apply memory-based capping
  const workerThreadCap = parseWorkerThreadCap(
    opts.workerThreadCap as Record<string, unknown> | undefined,
  );

  if (workerThreadCap.maxMemoryMB > 0) {
    const memoryBasedMax = Math.max(
      1,
      Math.floor(
        workerThreadCap.maxMemoryMB /
          workerThreadCap.estimatedMemoryPerWorkerMB,
      ),
    );
    if (memoryBasedMax < threads) {
      const originalThreads = threads;
      threads = memoryBasedMax;
      console.warn(
        `[NEAT-AI] Worker thread count capped from ${originalThreads} to ${threads} ` +
          `based on memory budget (maxMemoryMB: ${workerThreadCap.maxMemoryMB}, ` +
          `estimatedMemoryPerWorkerMB: ${workerThreadCap.estimatedMemoryPerWorkerMB})`,
      );
    }
  }

  const populationSize = parseNumber(
    "Population Size",
    opts.populationSize,
    50,
    { integer: true, min: 2 },
  );

  const config: NeatArguments = {
    creativeThinkingConnectionCount: parseNumber(
      "Creative thinking connection count",
      opts.creativeThinkingConnectionCount,
      1,
      { integer: true, min: 0 },
    ),
    creatureStore: options.creatureStore,
    experimentStore: options.experimentStore,
    creatures: options.creatures ? options.creatures : [],
    costName: options.costName ?? "MSE",
    dataSetPartitionBreak: parseNumber(
      "Data Set Partition Break",
      opts.dataSetPartitionBreak,
      2000,
      { integer: true, min: 1 },
    ),
    trainingSampleRate: parseNumber(
      "Training Sample Rate",
      opts.trainingSampleRate,
      1,
      { min: 0.0001, max: 1 },
    ),

    debug: options.debug === true || getGlobalDebug(),

    feedbackLoop: options.feedbackLoop || false,
    disableRandomSamples: options.disableRandomSamples ??
      options.feedbackLoop === true,
    focusList: options.focusList || [],
    focusRate: parseNumber("Focus rate", opts.focusRate, 0.25, {
      min: 0,
      max: 1,
    }),

    targetError: parseNumber("Target error", opts.targetError, 0.05, {
      min: 0,
      max: 1,
    }),

    costOfGrowth: parseNumber(
      "Cost of growth",
      opts.costOfGrowth,
      DEFAULT_COST_OF_GROWTH,
      { min: 0 },
    ),

    iterations: parseNumber(
      "Iterations",
      opts.iterations,
      Number.MAX_SAFE_INTEGER,
      { min: 0 },
    ),

    populationSize,
    elitism: parseNumber("Elitism", opts.elitism, 1, {
      integer: true,
      min: 1,
    }),

    maxConns: parseNumber(
      "Max Connections",
      opts.maxConns,
      Number.MAX_SAFE_INTEGER,
      { integer: true, min: 1 },
    ),
    maximumNumberOfNodes: parseNumber(
      "Maximum Number of Nodes",
      opts.maximumNumberOfNodes,
      Number.MAX_SAFE_INTEGER,
      { integer: true, min: 1 },
    ),
    mutationRate: parseNumber("Mutation Rate", opts.mutationRate, 0.3, {
      minExclusive: 0.001,
      max: 1,
    }),

    mutationAmount: parseNumber("Mutation Amount", opts.mutationAmount, 1, {
      integer: true,
      min: 1,
    }),

    mutation: options.mutation ? [...options.mutation] : [...Mutation.FFW],
    selection: selection,
    timeoutMinutes: parseNumber("Timeout Minutes", opts.timeoutMinutes, 0, {
      integer: true,
      min: 0,
    }),
    traceStore: options.traceStore,
    trainPerGen: parseNumber("Training per generation", opts.trainPerGen, 1, {
      integer: true,
      min: 0,
    }),

    log: parseNumber("Log", opts.log, options.verbose ? 1 : 0, {
      integer: true,
      min: 0,
    }),
    verbose: options.verbose ? true : false,

    enableRepetitiveTraining: options.enableRepetitiveTraining || false,

    trainingBatchSize: parseNumber(
      "Training Batch Size",
      opts.trainingBatchSize,
      100,
      { integer: true, min: 1 },
    ),
    threads,

    maximumBiasAdjustmentScale: parseNumber(
      "Maximum Bias Adjustment Scale",
      opts.maximumBiasAdjustmentScale,
      1,
      { min: 0 },
    ),

    maximumWeightAdjustmentScale: parseNumber(
      "Maximum Weight Adjustment Scale",
      opts.maximumWeightAdjustmentScale,
      1,
      { min: 0 },
    ),
    sparseRatio: parseNumber(
      "Sparse Ratio",
      opts.sparseRatio,
      rng.random() * rng.random(),
      { min: 0, max: 1 },
    ),
    globalBreedingRate: Math.max(
      Math.min(
        parseNumber(
          "Global breeding rate",
          opts.globalBreedingRate,
          rng.random(),
          { min: 0, max: 1 },
        ),
        1,
      ),
      0,
    ),
    CRISPRs: options.CRISPRs || [],
    geneticCompatibilityThreshold: parseNumber(
      "Genetic Compatibility Threshold",
      opts.geneticCompatibilityThreshold,
      0.3,
      { min: 0, max: 1 },
    ),
    discoverySampleRate: parseDiscoverySampleRate(
      opts.discoverySampleRate,
      DEFAULT_DISCOVERY_SAMPLE_RATE,
    ),
    discoveryRecordTimeOutMinutes: parseNumber(
      "Discovery record timeout minutes",
      opts.discoveryRecordTimeOutMinutes ?? opts.discoveryTimeOutMinutes,
      DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES,
      { min: 0 },
    ),
    discoveryAnalysisTimeoutMinutes: parseNumber(
      "Discovery Analysis Timeout Minutes",
      opts.discoveryAnalysisTimeoutMinutes,
      10,
      {
        min: MIN_ANALYSIS_TIMEOUT_MINUTES,
        max: MAX_ANALYSIS_TIMEOUT_MINUTES,
      },
    ),
    discoveryBatchSize: parseNumber(
      "Discovery batch size",
      opts.discoveryBatchSize,
      128,
      { integer: true, min: 1 },
    ),
    discoveryBufferSize: parseNumber(
      "Discovery buffer size",
      opts.discoveryBufferSize,
      0,
      { min: 0 },
    ),
    discoveryRustFlushRecords: parseNumber(
      "Discovery Rust Flush Records",
      opts.discoveryRustFlushRecords,
      DEFAULT_RUST_FLUSH_RECORDS,
      { integer: true, min: 1 },
    ),
    discoveryRustFlushBytes: parseNumber(
      "Discovery Rust Flush Bytes",
      opts.discoveryRustFlushBytes,
      DEFAULT_RUST_FLUSH_BYTES,
      { min: 1 },
    ),
    discoveryMaxNeurons: parseNumber(
      "Discovery max neurons",
      opts.discoveryMaxNeurons,
      6,
      { integer: true, min: 0 },
    ),
    discoveryDrainEveryNBatches: parseNumber(
      "Discovery drain every N batches",
      opts.discoveryDrainEveryNBatches,
      10,
      { integer: true, min: 1 },
    ),
    discoveryFocusNeuronUUIDs: options.discoveryFocusNeuronUUIDs
      ? [...options.discoveryFocusNeuronUUIDs]
      : [],
    discoveryDisableEvaluationSummaryLogging:
      options.discoveryDisableEvaluationSummaryLogging ?? false,
    customCost: options.customCost,
    checkpointEveryGeneration: options.checkpointEveryGeneration ?? false,
    discoveryDisableCleanup: options.discoveryDisableCleanup ?? false,
    discoveryBaseDirectory: options.discoveryBaseDirectory,
    discoverySkipRecordPhase: options.discoverySkipRecordPhase ?? false,
    discoveryCacheDir:
      options.discoveryCacheDir && options.discoveryCacheDir.trim()
        ? options.discoveryCacheDir.trim()
        : undefined,
    discoveryFailureCacheDir: (() => {
      if (options.discoveryFailureCacheDir) {
        return options.discoveryFailureCacheDir;
      }
      const base = options.discoveryCacheDir?.trim();
      return base ? `${base}/failure` : undefined;
    })(),
    discoverySuccessCacheDir: (() => {
      if (options.discoverySuccessCacheDir) {
        return options.discoverySuccessCacheDir;
      }
      const base = options.discoveryCacheDir?.trim();
      return base ? `${base}/success` : undefined;
    })(),
    discoveryReplayMaxSingles: parseNumber(
      "Discovery replay max singles",
      opts.discoveryReplayMaxSingles,
      Math.max(2 * threads, 10),
      { integer: true, min: 0 },
    ),
    discoveryReplayMaxPairwise: parseNumber(
      "Discovery replay max pairwise",
      opts.discoveryReplayMaxPairwise,
      10,
      { integer: true, min: 0 },
    ),
    discoveryReplayMaxTriples: parseNumber(
      "Discovery replay max triples",
      opts.discoveryReplayMaxTriples,
      8,
      { integer: true, min: 0 },
    ),
    discoveryReplayVerifyScores: options.discoveryReplayVerifyScores ?? false,
    discoveryReplayConcurrency: (() => {
      const verify = opts.discoveryReplayVerifyScores ?? false;
      const availableCores = Math.max(1, navigator.hardwareConcurrency ?? 1);
      const defaultWhenVerify = Math.max(availableCores, 8);
      const defaultConcurrency = verify ? defaultWhenVerify : threads;
      const parsed = parseNumber(
        "Discovery Replay Concurrency",
        opts.discoveryReplayConcurrency,
        defaultConcurrency,
        { min: 1 },
      );
      return Math.max(1, Math.floor(parsed));
    })(),
    discoveryReplayRescoreBaseline: (() => {
      const verify = options.discoveryReplayVerifyScores ?? false;
      const user = options.discoveryReplayRescoreBaseline;
      if (typeof user === "boolean") return user;
      return verify ? true : false;
    })(),
    discoveryReplayDiagnostics: options.discoveryReplayDiagnostics ?? false,
    discoveryReplayTimeoutMinutes: parseNumber(
      "Discovery replay timeout minutes",
      opts.discoveryReplayTimeoutMinutes,
      5,
      { min: 0 },
    ),
    discoveryReplayMinTimeMinutes: parseNumber(
      "Discovery replay min time minutes",
      opts.discoveryReplayMinTimeMinutes,
      1,
      { min: 0 },
    ),

    // Delegated sub-config parsing
    discoveryMinCandidatesPerCategory: parseDiscoveryMinCandidates(
      opts.discoveryMinCandidatesPerCategory as
        | Record<string, unknown>
        | undefined,
    ),
    adaptiveMutationThresholds: parseAdaptiveMutationThresholds(
      opts.adaptiveMutationThresholds as
        | Record<string, unknown>
        | undefined,
    ),
    plateauDetection: parsePlateauDetection(
      opts.plateauDetection as Record<string, unknown> | undefined,
    ),
    stabilityAdaptation: parseStabilityAdaptation(
      opts.stabilityAdaptation as Record<string, unknown> | undefined,
    ),
    weightRegularisation: parseWeightRegularisation(
      opts.weightRegularisation as Record<string, unknown> | undefined,
    ),
    biasRegularisation: parseBiasRegularisation(
      opts.biasRegularisation as Record<string, unknown> | undefined,
    ),
    ensembleDiversity: parseEnsembleDiversity(
      opts.ensembleDiversity as Record<string, unknown> | undefined,
    ),
    predictiveCoding: parsePredictiveCoding(
      opts.predictiveCoding as Record<string, unknown> | undefined,
    ),
    wasmCache: parseWasmCache(
      opts.wasmCache as Record<string, unknown> | undefined,
      populationSize,
    ),
    memory: parseMemoryConfig(
      opts.memory as Record<string, unknown> | undefined,
    ),
    workerThreadCap,
    quantumStep: parseQuantumStep(
      opts.quantumStep as Record<string, unknown> | undefined,
    ),
    fineTunePopulation: parseFineTunePopulation(
      opts.fineTunePopulation as Record<string, unknown> | undefined,
    ),
    // Issue #1620: Parse and resolve output range constraints
    outputRanges: (() => {
      const raw = options.outputRanges;
      if (!raw || raw.length === 0) return [] as RequiredOutputRange[];
      return raw.map((r) => ({
        min: parseNumber("Output range min", r.min, 0, {}),
        max: parseNumber("Output range max", r.max, 0, {}),
        penaltyWeight: parseNumber(
          "Output range penaltyWeight",
          r.penaltyWeight,
          DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT,
          { min: 0 },
        ),
      } as RequiredOutputRange));
    })(),

    logger: (() => {
      if (options.logger) return options.logger;
      return createConsoleLogger(options.logLevel ?? "info");
    })() as Logger,
    rng,
    onTrainingEvent: options.onTrainingEvent,
  };

  // Issue #1398: Set the global logger
  setLogger(config.logger);

  // Cross-field validation
  validateNeatConfig(config);
  return Object.freeze(config);
}
