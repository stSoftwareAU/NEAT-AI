import type { NeatOptions } from "../../mod.ts";
import {
  DEFAULT_RUST_FLUSH_BYTES,
  DEFAULT_RUST_FLUSH_RECORDS,
} from "../architecture/ErrorGuidedStructuralEvolution/constants.ts";
import { Selection, type SelectionInterface } from "../methods/Selection.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import {
  DEFAULT_PLATEAU_DETECTION,
  type RequiredPlateauDetectionConfig,
} from "../NEAT/PlateauDetector.ts";
import {
  DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS,
  type RequiredAdaptiveMutationThresholds,
} from "./AdaptiveMutationThresholds.ts";
import type { DiscoveryMinCandidatesPerCategory } from "./DiscoveryMinCandidatesPerCategory.ts";
import type { NeatArguments } from "./NeatArguments.ts";

/**
 * Default cost of growth value used when not specified in options.
 * This is the single source of truth for the default costOfGrowth.
 */
export const DEFAULT_COST_OF_GROWTH = 0.000_000_1;

/**
 * Minimum allowed cost of growth value.
 */
export const MIN_COST_OF_GROWTH = 0.000_000_000_1;

/**
 * Minimum allowed discovery analysis timeout in minutes.
 * The Rust library requires at least 3 seconds (0.05 minutes).
 */
export const MIN_ANALYSIS_TIMEOUT_MINUTES = 0.05; // 3 seconds

/**
 * Maximum allowed discovery analysis timeout in minutes.
 * The Rust library allows up to 1 hour (60 minutes).
 */
export const MAX_ANALYSIS_TIMEOUT_MINUTES = 60; // 1 hour

/**
 * Default minimum candidates per discovery category.
 * These values reflect the current behaviour where diversity selection
 * picks at least 1 from each category, and removal candidates sample 3.
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
 * Interface for NEAT (NeuroEvolution of Augmenting Topologies) training options.
 * Provides a read-only configuration object for the NEAT algorithm.
 */
export type NeatConfig = Readonly<NeatArguments>;

/**
 * Creates a validated NEAT configuration from user options.
 *
 * This function takes partial user options and fills in default values
 * to create a complete, validated configuration for the NEAT algorithm.
 * It handles selection strategy randomization and validates all parameters
 * to ensure they are within acceptable ranges.
 *
 * @param options - Partial configuration options from the user
 * @returns A frozen, validated NEAT configuration object
 * @throws {Error} When configuration parameters are invalid
 *
 * @example
 * ```ts
 * const config = createNeatConfig({
 *   populationSize: 100,
 *   mutationRate: 0.3,
 *   costName: "MSE"
 * });
 * ```
 */
export function createNeatConfig(options: NeatOptions): NeatConfig {
  let selection: SelectionInterface = Selection.POWER;
  if (options.selection) {
    selection = options.selection;
  } else {
    const r0 = Math.random();
    if (r0 < 0.33) {
      selection = Selection.FITNESS_PROPORTIONATE;
    } else if (r0 < 0.66) {
      selection = Selection.TOURNAMENT;
    }
  }

  const config: NeatArguments = {
    creativeThinkingConnectionCount: options.creativeThinkingConnectionCount ??
      1,
    creatureStore: options.creatureStore,
    experimentStore: options.experimentStore,
    creatures: options.creatures ? options.creatures : [],
    costName: options.costName ?? "MSE",
    dataSetPartitionBreak: options.dataSetPartitionBreak ?? 2000,
    trainingSampleRate: options.trainingSampleRate ?? 1,

    debug: options.debug
      ? true
      : ((globalThis as unknown) as { DEBUG: boolean }).DEBUG
      ? true
      : false,

    feedbackLoop: options.feedbackLoop || false,
    disableRandomSamples: options.disableRandomSamples ??
      options.feedbackLoop === true,
    focusList: options.focusList || [],
    focusRate: options.focusRate || 0.25,

    targetError: options.targetError ?? 0.05,

    costOfGrowth: Math.max(
      options.costOfGrowth ?? DEFAULT_COST_OF_GROWTH,
      MIN_COST_OF_GROWTH,
    ),

    iterations: options.iterations ?? Number.MAX_SAFE_INTEGER,

    populationSize: options.populationSize || 50,
    elitism: options.elitism || 1,

    maxConns: options.maxConns || Number.MAX_SAFE_INTEGER,
    maximumNumberOfNodes: options.maximumNumberOfNodes ||
      Number.MAX_SAFE_INTEGER,
    mutationRate: options.mutationRate || 0.3,

    mutationAmount: options.mutationAmount ?? 1,

    mutation: options.mutation ? [...options.mutation] : [...Mutation.FFW],
    selection: selection,
    timeoutMinutes: options.timeoutMinutes ?? 0,
    traceStore: options.traceStore,
    trainPerGen: options.trainPerGen ?? 1,

    log: options.log ?? (options.verbose ? 1 : 0),
    verbose: options.verbose ? true : false,

    enableRepetitiveTraining: options.enableRepetitiveTraining || false,

    trainingBatchSize: options.trainingBatchSize || 100,
    threads: options.threads ??
      Math.max(1, navigator.hardwareConcurrency ?? 1),

    maximumBiasAdjustmentScale: options.maximumBiasAdjustmentScale ?? 1,

    maximumWeightAdjustmentScale: options.maximumWeightAdjustmentScale ?? 1,
    sparseRatio: options.sparseRatio ?? Math.random() * Math.random(),
    globalBreedingRate: Math.max(
      Math.min(options.globalBreedingRate ?? Math.random(), 1),
      0,
    ),
    CRISPRs: options.CRISPRs || [],
    geneticCompatibilityThreshold: options.geneticCompatibilityThreshold || 0.3,
    discoverySampleRate: options.discoverySampleRate === undefined
      ? 0.05
      : options.discoverySampleRate,
    discoveryRecordTimeOutMinutes: (() => {
      const legacyRecordTimeout = (options as {
        discoveryTimeOutMinutes?: number;
      }).discoveryTimeOutMinutes;
      const recordTimeout = options.discoveryRecordTimeOutMinutes ??
        legacyRecordTimeout ??
        1;
      return recordTimeout;
    })(), // Default 1 min for recording (was 0). Legacy discoveryTimeOutMinutes is still accepted.
    discoveryAnalysisTimeoutMinutes: options.discoveryAnalysisTimeoutMinutes ??
      10, // Default 10 min for analysis (was 3 - production-tuned)
    discoveryBatchSize: options.discoveryBatchSize || 128,
    discoveryBufferSize: options.discoveryBufferSize || 0,
    discoveryRustFlushRecords: options.discoveryRustFlushRecords ??
      DEFAULT_RUST_FLUSH_RECORDS,
    discoveryRustFlushBytes: options.discoveryRustFlushBytes ??
      DEFAULT_RUST_FLUSH_BYTES,
    discoveryMaxNeurons: options.discoveryMaxNeurons ?? 6, // Default 6 neurons (was 0 - production-tuned)
    discoveryDrainEveryNBatches: options.discoveryDrainEveryNBatches ?? 10,
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
    // Issue #997: discoveryCacheDir provides a base directory for discovery caching.
    // Empty strings are treated as undefined (not provided).
    discoveryCacheDir:
      options.discoveryCacheDir && options.discoveryCacheDir.trim()
        ? options.discoveryCacheDir.trim()
        : undefined,
    // Issue #997: Derive failure/success cache dirs from discoveryCacheDir if not explicitly set.
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
    discoveryReplayMaxSingles: options.discoveryReplayMaxSingles ??
      Math.max(2 * (options.threads ?? 1), 10),
    discoveryReplayMaxPairwise: options.discoveryReplayMaxPairwise ?? 10,
    discoveryReplayMaxTriples: options.discoveryReplayMaxTriples ?? 8,
    discoveryReplayVerifyScores: options.discoveryReplayVerifyScores ?? false,
    discoveryReplayConcurrency: (() => {
      const verify = options.discoveryReplayVerifyScores ?? false;
      const availableCores = Math.max(1, navigator.hardwareConcurrency ?? 1);
      const defaultWhenVerify = Math.max(availableCores, 8);
      const user = options.discoveryReplayConcurrency;
      if (typeof user === "number" && Number.isFinite(user)) {
        return Math.max(1, Math.floor(user));
      }
      return verify ? defaultWhenVerify : (options.threads ??
        Math.max(1, navigator.hardwareConcurrency ?? 1));
    })(),
    discoveryReplayRescoreBaseline: (() => {
      const verify = options.discoveryReplayVerifyScores ?? false;
      const user = options.discoveryReplayRescoreBaseline;
      if (typeof user === "boolean") return user;
      return verify ? true : false;
    })(),
    discoveryReplayDiagnostics: options.discoveryReplayDiagnostics ?? false,
    discoveryMinCandidatesPerCategory: {
      ...DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY,
      ...options.discoveryMinCandidatesPerCategory,
    } as Required<DiscoveryMinCandidatesPerCategory>,
    adaptiveMutationThresholds: {
      ...DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS,
      ...options.adaptiveMutationThresholds,
    } as RequiredAdaptiveMutationThresholds,
    plateauDetection: {
      ...DEFAULT_PLATEAU_DETECTION,
      ...options.plateauDetection,
    } as RequiredPlateauDetectionConfig,
  };
  validate(config);
  return Object.freeze(config);
}

function validate(config: NeatArguments) {
  if (
    Number.isFinite(config.sparseRatio) === false || config.sparseRatio < 0 ||
    config.sparseRatio > 1
  ) {
    throw new Error(
      `Sparse Ratio must be between 0 and 1 was: ${config.sparseRatio}`,
    );
  }

  if (config.feedbackLoop === true && config.disableRandomSamples === false) {
    throw new Error(
      "Feedback Loop, Disable Random Samples must be set together",
    );
  }
  if (Number.isInteger(config.threads) === false || config.threads < 1) {
    throw new Error(
      `Threads must be more than zero was: ${config.threads}`,
    );
  }

  if (
    Number.isInteger(config.discoveryReplayConcurrency) === false ||
    config.discoveryReplayConcurrency < 1
  ) {
    throw new Error(
      `Discovery Replay Concurrency must be an integer greater than 0 was: ${config.discoveryReplayConcurrency}`,
    );
  }

  if (Number.isInteger(config.log) === false || config.log < 0) {
    throw new Error(
      `Training per generation must be zero or more: ${config.trainPerGen}`,
    );
  }
  if (
    Number.isInteger(config.trainPerGen) === false || config.trainPerGen < 0
  ) {
    throw new Error(
      `Training per generation must be zero or more: ${config.trainPerGen}`,
    );
  }
  if (
    Number.isInteger(config.timeoutMinutes) === false ||
    config.timeoutMinutes < 0
  ) {
    throw new Error(
      `Timeout Minutes must be zero or more: ${config.timeoutMinutes}`,
    );
  }
  if (Number.isInteger(config.dataSetPartitionBreak) === false) {
    throw new Error(
      "Data Set Partition Break must be an integer was: " +
        config.dataSetPartitionBreak,
    );
  }
  if (config.dataSetPartitionBreak < 1) {
    throw new Error(
      "Data Set Partition Break must be more than zero was: " +
        config.dataSetPartitionBreak,
    );
  }

  if (config.populationSize < 2) {
    throw new Error(
      "Population Size must be more than 1 was: " + config.populationSize,
    );
  }

  if (config.elitism < 1) {
    throw new Error("Elitism must be more than zero was: " + config.elitism);
  }

  if (config.maxConns < 1 || Number.isInteger(config.maxConns) === false) {
    throw new Error(
      "Max Connections must be more than zero was: " + config.maxConns,
    );
  }

  if (
    Number.isInteger(config.maximumNumberOfNodes) === false ||
    config.maximumNumberOfNodes < 1
  ) {
    throw new Error(
      `Maximum Number of Nodes must be more than zero was: ${config.maximumNumberOfNodes}`,
    );
  }

  if (config.mutationRate <= 0.001) {
    throw new Error(
      `Mutation Rate must be more than zero was: ${config.mutationRate}`,
    );
  }

  if (config.iterations < 0) {
    throw new Error(
      "Iterations must be more than zero was: " + config.iterations,
    );
  }

  if (config.trainingBatchSize < 1) {
    throw new Error(
      "Training Batch Size must be more than zero was: " +
        config.trainingBatchSize,
    );
  }
  if (
    Number.isFinite(config.trainingSampleRate) === false ||
    config.trainingSampleRate < 0.0001 || config.trainingSampleRate > 1
  ) {
    throw new Error(
      `Training Sample Rate must be between 0.0001 and 1 was: ${config.trainingSampleRate}`,
    );
  }
  if (
    Number.isInteger(config.mutationAmount) === false ||
    config.mutationAmount < 1
  ) {
    throw new Error(
      `Mutation Amount must be more than zero was: ${config.mutationAmount}`,
    );
  }

  if (
    Number.isFinite(config.targetError) === false || config.targetError < 0 ||
    config.targetError > 1
  ) {
    throw new Error(
      `Target error must be between 0 and 1 was: ${config.targetError}`,
    );
  }

  if (
    Number.isFinite(config.maximumBiasAdjustmentScale) === false ||
    config.maximumBiasAdjustmentScale < 0
  ) {
    throw new Error(
      `Maximum Bias Adjustment Scale must be more than zero was: ${config.maximumBiasAdjustmentScale}`,
    );
  }
  if (
    Number.isFinite(config.maximumWeightAdjustmentScale) === false ||
    config.maximumWeightAdjustmentScale < 0
  ) {
    throw new Error(
      `Maximum Weight Adjustment Scale must be more than zero was: ${config.maximumWeightAdjustmentScale}`,
    );
  }
  if (
    Number.isFinite(config.geneticCompatibilityThreshold) === false ||
    config.geneticCompatibilityThreshold < 0 ||
    config.geneticCompatibilityThreshold > 1
  ) {
    throw new Error(
      `Genetic Compatibility Threshold must be between 0 and 1 was: ${config.geneticCompatibilityThreshold}`,
    );
  }
  // Rust library requires timeout between 3 seconds (0.05 min) and 1 hour (60 min)
  if (
    Number.isFinite(config.discoveryAnalysisTimeoutMinutes) === false ||
    config.discoveryAnalysisTimeoutMinutes < MIN_ANALYSIS_TIMEOUT_MINUTES ||
    config.discoveryAnalysisTimeoutMinutes > MAX_ANALYSIS_TIMEOUT_MINUTES
  ) {
    throw new Error(
      `Discovery Analysis Timeout Minutes must be between ${MIN_ANALYSIS_TIMEOUT_MINUTES} (3 seconds) and ${MAX_ANALYSIS_TIMEOUT_MINUTES} (1 hour), was: ${config.discoveryAnalysisTimeoutMinutes}`,
    );
  }
  if (
    Number.isInteger(config.discoveryRustFlushRecords) === false ||
    config.discoveryRustFlushRecords < 1
  ) {
    throw new Error(
      `Discovery Rust Flush Records must be an integer greater than 0 was: ${config.discoveryRustFlushRecords}`,
    );
  }
  if (
    Number.isFinite(config.discoveryRustFlushBytes) === false ||
    config.discoveryRustFlushBytes < 1
  ) {
    throw new Error(
      `Discovery Rust Flush Bytes must be greater than 0 was: ${config.discoveryRustFlushBytes}`,
    );
  }
  if (!Array.isArray(config.discoveryFocusNeuronUUIDs)) {
    throw new Error(
      "Discovery focus neuron UUIDs must be an array when provided.",
    );
  }
  for (const uuid of config.discoveryFocusNeuronUUIDs) {
    if (typeof uuid !== "string" || uuid.trim().length === 0) {
      throw new Error(
        `Discovery focus neuron UUIDs must be non-empty strings, found: ${
          String(uuid)
        }`,
      );
    }
  }
  // Validate discoveryMinCandidatesPerCategory
  const minCandidates = config.discoveryMinCandidatesPerCategory;
  if (minCandidates) {
    if (
      !Number.isInteger(minCandidates.addNeurons) ||
      minCandidates.addNeurons < 0
    ) {
      throw new Error(
        `Discovery min candidates for addNeurons must be a non-negative integer, was: ${minCandidates.addNeurons}`,
      );
    }
    if (
      !Number.isInteger(minCandidates.addSynapses) ||
      minCandidates.addSynapses < 0
    ) {
      throw new Error(
        `Discovery min candidates for addSynapses must be a non-negative integer, was: ${minCandidates.addSynapses}`,
      );
    }
    if (
      !Number.isInteger(minCandidates.changeSquash) ||
      minCandidates.changeSquash < 0
    ) {
      throw new Error(
        `Discovery min candidates for changeSquash must be a non-negative integer, was: ${minCandidates.changeSquash}`,
      );
    }
    if (
      !Number.isInteger(minCandidates.removeLowImpact) ||
      minCandidates.removeLowImpact < 0
    ) {
      throw new Error(
        `Discovery min candidates for removeLowImpact must be a non-negative integer, was: ${minCandidates.removeLowImpact}`,
      );
    }
  }
  // Validate adaptiveMutationThresholds (Issue #1037)
  const adaptiveThresholds = config.adaptiveMutationThresholds;
  if (adaptiveThresholds) {
    if (
      !Number.isInteger(adaptiveThresholds.medium) ||
      adaptiveThresholds.medium < 1
    ) {
      throw new Error(
        `Adaptive mutation medium threshold must be a positive integer, was: ${adaptiveThresholds.medium}`,
      );
    }
    if (
      !Number.isInteger(adaptiveThresholds.large) ||
      adaptiveThresholds.large < 1
    ) {
      throw new Error(
        `Adaptive mutation large threshold must be a positive integer, was: ${adaptiveThresholds.large}`,
      );
    }
    if (adaptiveThresholds.large <= adaptiveThresholds.medium) {
      throw new Error(
        `Adaptive mutation large threshold must be greater than medium threshold. ` +
          `Large: ${adaptiveThresholds.large}, Medium: ${adaptiveThresholds.medium}`,
      );
    }
    if (
      !Number.isFinite(adaptiveThresholds.largeTopologyWeight) ||
      adaptiveThresholds.largeTopologyWeight < 0 ||
      adaptiveThresholds.largeTopologyWeight > 1
    ) {
      throw new Error(
        `Adaptive mutation largeTopologyWeight must be between 0 and 1, was: ${adaptiveThresholds.largeTopologyWeight}`,
      );
    }
  }
  // Validate plateauDetection (Issue #1039 and Issue #1012)
  const plateauDetection = config.plateauDetection;
  if (plateauDetection) {
    if (
      !Number.isInteger(plateauDetection.windowSize) ||
      plateauDetection.windowSize < 1
    ) {
      throw new Error(
        `Plateau detection windowSize must be a positive integer, was: ${plateauDetection.windowSize}`,
      );
    }
    if (
      !Number.isFinite(plateauDetection.minImprovementRate) ||
      plateauDetection.minImprovementRate < 0 ||
      plateauDetection.minImprovementRate > 1
    ) {
      throw new Error(
        `Plateau detection minImprovementRate must be between 0 and 1, was: ${plateauDetection.minImprovementRate}`,
      );
    }
    if (
      !Number.isFinite(plateauDetection.responseMutationMultiplier) ||
      plateauDetection.responseMutationMultiplier < 1
    ) {
      throw new Error(
        `Plateau detection responseMutationMultiplier must be >= 1, was: ${plateauDetection.responseMutationMultiplier}`,
      );
    }
    // Issue #1012: Validate responseImprovementMultiplier
    if (
      !Number.isFinite(plateauDetection.responseImprovementMultiplier) ||
      plateauDetection.responseImprovementMultiplier < 0 ||
      plateauDetection.responseImprovementMultiplier > 1
    ) {
      throw new Error(
        `Plateau detection responseImprovementMultiplier must be between 0 and 1, was: ${plateauDetection.responseImprovementMultiplier}`,
      );
    }
    // Issue #1012: Validate rapidImprovementRate
    if (
      !Number.isFinite(plateauDetection.rapidImprovementRate) ||
      plateauDetection.rapidImprovementRate < 0 ||
      plateauDetection.rapidImprovementRate > 1
    ) {
      throw new Error(
        `Plateau detection rapidImprovementRate must be between 0 and 1, was: ${plateauDetection.rapidImprovementRate}`,
      );
    }
    // Issue #1012: Validate rapidImprovementRate > minImprovementRate
    if (
      plateauDetection.rapidImprovementRate <=
        plateauDetection.minImprovementRate
    ) {
      throw new Error(
        `Plateau detection rapidImprovementRate must be greater than minImprovementRate. ` +
          `rapidImprovementRate: ${plateauDetection.rapidImprovementRate}, minImprovementRate: ${plateauDetection.minImprovementRate}`,
      );
    }
  }
}
