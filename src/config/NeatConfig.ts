import type { NeatOptionsInput } from "./NeatOptions.ts";
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
import {
  DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
  type RequiredEnsembleDiversityConfig,
} from "./EnsembleDiversityConfig.ts";
import {
  DEFAULT_FINE_TUNE_POPULATION_CONFIG,
  type RequiredFineTunePopulationConfig,
} from "./FineTunePopulationConfig.ts";
import type { NeatArguments } from "./NeatArguments.ts";
import { parseDiscoverySampleRate, parseNumber } from "./ParseOptions.ts";
import {
  DEFAULT_QUANTUM_STEP_CONFIG,
  type RequiredQuantumStepConfig,
} from "./QuantumStepConfig.ts";
import {
  DEFAULT_STABILITY_ADAPTATION_CONFIG,
  type RequiredStabilityAdaptationConfig,
} from "./StabilityAdaptationConfig.ts";
import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
  type RequiredBiasRegularisationConfig,
} from "./BiasRegularisationConfig.ts";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  type RequiredWeightRegularisationConfig,
} from "./WeightRegularisationConfig.ts";
import {
  createConsoleLogger,
  type Logger,
  setLogger,
} from "../utils/Logger.ts";

/**
 * Default cost of growth value used when not specified in options.
 * This is the single source of truth for the default costOfGrowth.
 */
export const DEFAULT_COST_OF_GROWTH = 0.000_000_1;

/**
 * Default discovery sample rate.
 *
 * Issue #1386: Increased from 0.05 (5%) to 0.2 (20%) so that the Rust
 * discovery engine has 4x more data points to base structural decisions on.
 * A larger sample improves the statistical significance of candidate rankings
 * and reduces the chance of missing important edge cases.
 */
export const DEFAULT_DISCOVERY_SAMPLE_RATE = 0.2;

/**
 * Default maximum minutes allocated to the recording phase before discovery
 * advances to analysis.
 *
 * Issue #1386: Increased from 1 minute to 5 minutes to accommodate the higher
 * default sample rate. At ~700 records/sec, 5 minutes allows recording ~210k
 * samples, which is sufficient for a 20% sample of a 1M-record dataset.
 */
export const DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES = 5;

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
 * @param options - Partial configuration options from the user. Numeric options
 * (e.g. trainingSampleRate, targetError, populationSize) accept string or number,
 * so CLI-derived values can be passed without pre-parsing (Issue #1280).
 * @returns A frozen, validated NEAT configuration object
 * @throws {Error} When configuration parameters are invalid (parse/validation happens here)
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
export function createNeatConfig(options: NeatOptionsInput): NeatConfig {
  const opts = options as Record<string, unknown>;
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

  const defaultThreads = Math.max(1, navigator.hardwareConcurrency ?? 1);
  const threads = parseNumber("Threads", opts.threads, defaultThreads, {
    integer: true,
    min: 1,
  });

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

    debug: options.debug
      ? true
      : ((globalThis as unknown) as { DEBUG: boolean }).DEBUG
      ? true
      : false,

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
      {
        min: 0,
      },
    ),

    iterations: parseNumber(
      "Iterations",
      opts.iterations,
      Number.MAX_SAFE_INTEGER,
      { min: 0 },
    ),

    populationSize: parseNumber("Population Size", opts.populationSize, 50, {
      integer: true,
      min: 2,
    }),
    elitism: parseNumber("Elitism", opts.elitism, 1, {
      integer: true,
      min: 1,
    }),

    maxConns: parseNumber(
      "Max Connections",
      opts.maxConns,
      Number.MAX_SAFE_INTEGER,
      {
        integer: true,
        min: 1,
      },
    ),
    maximumNumberOfNodes: parseNumber(
      "Maximum Number of Nodes",
      opts.maximumNumberOfNodes,
      Number.MAX_SAFE_INTEGER,
      { integer: true, min: 1 },
    ),
    mutationRate: parseNumber("Mutation Rate", opts.mutationRate, 0.3, {
      minExclusive: 0.001,
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
      Math.random() * Math.random(),
      { min: 0, max: 1 },
    ),
    globalBreedingRate: Math.max(
      Math.min(
        parseNumber(
          "Global breeding rate",
          opts.globalBreedingRate,
          Math.random(),
          {
            min: 0,
            max: 1,
          },
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
    discoveryMinCandidatesPerCategory: (() => {
      const overrides = opts.discoveryMinCandidatesPerCategory as
        | Record<
          string,
          unknown
        >
        | undefined;
      const d = DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY;
      return {
        addNeurons: parseNumber(
          "Discovery min candidates addNeurons",
          overrides?.addNeurons,
          d.addNeurons,
          { integer: true, min: 0 },
        ),
        addSynapses: parseNumber(
          "Discovery min candidates addSynapses",
          overrides?.addSynapses,
          d.addSynapses,
          { integer: true, min: 0 },
        ),
        changeSquash: parseNumber(
          "Discovery min candidates changeSquash",
          overrides?.changeSquash,
          d.changeSquash,
          { integer: true, min: 0 },
        ),
        removeLowImpact: parseNumber(
          "Discovery min candidates removeLowImpact",
          overrides?.removeLowImpact,
          d.removeLowImpact,
          { integer: true, min: 0 },
        ),
      } as Required<DiscoveryMinCandidatesPerCategory>;
    })(),
    adaptiveMutationThresholds: (() => {
      const overrides = opts.adaptiveMutationThresholds as
        | Record<
          string,
          unknown
        >
        | undefined;
      const d = DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS;
      return {
        medium: parseNumber(
          "Adaptive mutation medium threshold",
          overrides?.medium,
          d.medium,
          { integer: true, min: 1 },
        ),
        large: parseNumber(
          "Adaptive mutation large threshold",
          overrides?.large,
          d.large,
          { integer: true, min: 1 },
        ),
        largeTopologyWeight: parseNumber(
          "Adaptive mutation largeTopologyWeight",
          overrides?.largeTopologyWeight,
          d.largeTopologyWeight,
          { min: 0, max: 1 },
        ),
      } as RequiredAdaptiveMutationThresholds;
    })(),
    plateauDetection: (() => {
      const overrides = opts.plateauDetection as
        | Record<string, unknown>
        | undefined;
      const d = DEFAULT_PLATEAU_DETECTION;
      return {
        windowSize: parseNumber(
          "Plateau detection windowSize",
          overrides?.windowSize,
          d.windowSize,
          { integer: true, min: 1 },
        ),
        minImprovementRate: parseNumber(
          "Plateau detection minImprovementRate",
          overrides?.minImprovementRate,
          d.minImprovementRate,
          { min: 0, max: 1 },
        ),
        rapidImprovementRate: parseNumber(
          "Plateau detection rapidImprovementRate",
          overrides?.rapidImprovementRate,
          d.rapidImprovementRate,
          { min: 0, max: 1 },
        ),
        responseMutationMultiplier: parseNumber(
          "Plateau detection responseMutationMultiplier",
          overrides?.responseMutationMultiplier,
          d.responseMutationMultiplier,
          { min: 1 },
        ),
        responseImprovementMultiplier: parseNumber(
          "Plateau detection responseImprovementMultiplier",
          overrides?.responseImprovementMultiplier,
          d.responseImprovementMultiplier,
          { min: 0, max: 1 },
        ),
        enabled: typeof overrides?.enabled === "boolean"
          ? overrides.enabled
          : d.enabled,
      } as RequiredPlateauDetectionConfig;
    })(),
    // Issue #1307: Stability-based mutation adaptation configuration
    stabilityAdaptation: (() => {
      const overrides = opts.stabilityAdaptation as
        | Record<string, unknown>
        | undefined;
      const d = DEFAULT_STABILITY_ADAPTATION_CONFIG;
      return {
        enabled: typeof overrides?.enabled === "boolean"
          ? overrides.enabled
          : d.enabled,
        stabilityWindowSize: parseNumber(
          "Stability adaptation windowSize",
          overrides?.stabilityWindowSize,
          d.stabilityWindowSize,
          { integer: true, min: 1 },
        ),
        brittlenessThreshold: parseNumber(
          "Stability adaptation brittlenessThreshold",
          overrides?.brittlenessThreshold,
          d.brittlenessThreshold,
          { min: 0, max: 1 },
        ),
        brittleReductionFactor: parseNumber(
          "Stability adaptation brittleReductionFactor",
          overrides?.brittleReductionFactor,
          d.brittleReductionFactor,
          { min: 0, max: 1 },
        ),
        stableBoostFactor: parseNumber(
          "Stability adaptation stableBoostFactor",
          overrides?.stableBoostFactor,
          d.stableBoostFactor,
          { min: 1 },
        ),
        stableBoostThreshold: parseNumber(
          "Stability adaptation stableBoostThreshold",
          overrides?.stableBoostThreshold,
          d.stableBoostThreshold,
          { min: 0, max: 1 },
        ),
        selectionStabilityWeight: parseNumber(
          "Stability adaptation selectionStabilityWeight",
          overrides?.selectionStabilityWeight,
          d.selectionStabilityWeight,
          { min: 0, max: 1 },
        ),
        adaptiveSelectionWeight: typeof overrides?.adaptiveSelectionWeight ===
            "boolean"
          ? overrides.adaptiveSelectionWeight
          : d.adaptiveSelectionWeight,
        topologyMutationReductionForBrittle: parseNumber(
          "Stability adaptation topologyMutationReductionForBrittle",
          overrides?.topologyMutationReductionForBrittle,
          d.topologyMutationReductionForBrittle,
          { min: 0, max: 1 },
        ),
        trackPerMutationType: typeof overrides?.trackPerMutationType ===
            "boolean"
          ? overrides.trackPerMutationType
          : d.trackPerMutationType,
      } as RequiredStabilityAdaptationConfig;
    })(),
    // Issue #1309: Weight regularisation during mutation
    weightRegularisation: (() => {
      const overrides = opts.weightRegularisation as
        | Record<string, unknown>
        | undefined;
      const d = DEFAULT_WEIGHT_REGULARISATION_CONFIG;
      return {
        enabled: typeof overrides?.enabled === "boolean"
          ? overrides.enabled
          : d.enabled,
        maxAbsoluteWeight: parseNumber(
          "Weight regularisation maxAbsoluteWeight",
          overrides?.maxAbsoluteWeight,
          d.maxAbsoluteWeight,
          { min: 0.001 },
        ),
        maxWeightChange: parseNumber(
          "Weight regularisation maxWeightChange",
          overrides?.maxWeightChange,
          d.maxWeightChange,
          { min: 0.001 },
        ),
        l2Strength: parseNumber(
          "Weight regularisation l2Strength",
          overrides?.l2Strength,
          d.l2Strength,
          { min: 0, max: 1 },
        ),
        preferSmallChanges: typeof overrides?.preferSmallChanges === "boolean"
          ? overrides.preferSmallChanges
          : d.preferSmallChanges,
        smallChangeScale: parseNumber(
          "Weight regularisation smallChangeScale",
          overrides?.smallChangeScale,
          d.smallChangeScale,
          { min: 0, max: 1 },
        ),
      } as RequiredWeightRegularisationConfig;
    })(),
    // Issue #1416: Bias regularisation during mutation
    biasRegularisation: (() => {
      const overrides = opts.biasRegularisation as
        | Record<string, unknown>
        | undefined;
      const d = DEFAULT_BIAS_REGULARISATION_CONFIG;
      return {
        enabled: typeof overrides?.enabled === "boolean"
          ? overrides.enabled
          : d.enabled,
        maxAbsoluteBias: parseNumber(
          "Bias regularisation maxAbsoluteBias",
          overrides?.maxAbsoluteBias,
          d.maxAbsoluteBias,
          { min: 0.001 },
        ),
        maxBiasChange: parseNumber(
          "Bias regularisation maxBiasChange",
          overrides?.maxBiasChange,
          d.maxBiasChange,
          { min: 0.001 },
        ),
        l2Strength: parseNumber(
          "Bias regularisation l2Strength",
          overrides?.l2Strength,
          d.l2Strength,
          { min: 0, max: 1 },
        ),
        preferSmallChanges: typeof overrides?.preferSmallChanges === "boolean"
          ? overrides.preferSmallChanges
          : d.preferSmallChanges,
        smallChangeScale: parseNumber(
          "Bias regularisation smallChangeScale",
          overrides?.smallChangeScale,
          d.smallChangeScale,
          { min: 0, max: 1 },
        ),
      } as RequiredBiasRegularisationConfig;
    })(),
    // Issue #1310: Ensemble diversity scoring for species
    ensembleDiversity: (() => {
      const overrides = opts.ensembleDiversity as
        | Record<string, unknown>
        | undefined;
      const d = DEFAULT_ENSEMBLE_DIVERSITY_CONFIG;
      return {
        enabled: typeof overrides?.enabled === "boolean"
          ? overrides.enabled
          : d.enabled,
        diversityWeight: parseNumber(
          "Ensemble diversity diversityWeight",
          overrides?.diversityWeight,
          d.diversityWeight,
          { min: 0, max: 1 },
        ),
        weightVarianceWeight: parseNumber(
          "Ensemble diversity weightVarianceWeight",
          overrides?.weightVarianceWeight,
          d.weightVarianceWeight,
          { min: 0, max: 1 },
        ),
        squashEntropyWeight: parseNumber(
          "Ensemble diversity squashEntropyWeight",
          overrides?.squashEntropyWeight,
          d.squashEntropyWeight,
          { min: 0, max: 1 },
        ),
        topologyDiversityWeight: parseNumber(
          "Ensemble diversity topologyDiversityWeight",
          overrides?.topologyDiversityWeight,
          d.topologyDiversityWeight,
          { min: 0, max: 1 },
        ),
        protectDiverseLowPerformers:
          typeof overrides?.protectDiverseLowPerformers === "boolean"
            ? overrides.protectDiverseLowPerformers
            : d.protectDiverseLowPerformers,
        diversityProtectionThreshold: parseNumber(
          "Ensemble diversity diversityProtectionThreshold",
          overrides?.diversityProtectionThreshold,
          d.diversityProtectionThreshold,
          { min: 0, max: 1 },
        ),
        crossSpeciesBreedingThreshold: parseNumber(
          "Ensemble diversity crossSpeciesBreedingThreshold",
          overrides?.crossSpeciesBreedingThreshold,
          d.crossSpeciesBreedingThreshold,
          { min: 0, max: 1 },
        ),
        lowDiversityThreshold: parseNumber(
          "Ensemble diversity lowDiversityThreshold",
          overrides?.lowDiversityThreshold,
          d.lowDiversityThreshold,
          { min: 0, max: 1 },
        ),
        diverseParentPreferenceWeight: parseNumber(
          "Ensemble diversity diverseParentPreferenceWeight",
          overrides?.diverseParentPreferenceWeight,
          d.diverseParentPreferenceWeight,
          { min: 0, max: 1 },
        ),
      } as RequiredEnsembleDiversityConfig;
    })(),
    // Issue #1330: Adaptive quantum step sizing for memetic fine-tuning
    quantumStep: (() => {
      const overrides = opts.quantumStep as
        | Record<string, unknown>
        | undefined;
      const d = DEFAULT_QUANTUM_STEP_CONFIG;
      return {
        minStep: parseNumber(
          "Quantum step minStep",
          overrides?.minStep,
          d.minStep,
          { min: 0.000_000_000_001 },
        ),
        maxStep: parseNumber(
          "Quantum step maxStep",
          overrides?.maxStep,
          d.maxStep,
          { min: 0.000_000_000_001 },
        ),
        errorScale: parseNumber(
          "Quantum step errorScale",
          overrides?.errorScale,
          d.errorScale,
          { min: 0 },
        ),
      } as RequiredQuantumStepConfig;
    })(),
    // Issue #1323: Adaptive fine-tuning population sizing
    fineTunePopulation: (() => {
      const overrides = opts.fineTunePopulation as
        | Record<string, unknown>
        | undefined;
      const d = DEFAULT_FINE_TUNE_POPULATION_CONFIG;
      return {
        minPopulationFraction: parseNumber(
          "Fine-tune population minPopulationFraction",
          overrides?.minPopulationFraction,
          d.minPopulationFraction,
          { min: 0, max: 1 },
        ),
        maxPopulationFraction: parseNumber(
          "Fine-tune population maxPopulationFraction",
          overrides?.maxPopulationFraction,
          d.maxPopulationFraction,
          { min: 0, max: 1 },
        ),
        basePopulationFraction: parseNumber(
          "Fine-tune population basePopulationFraction",
          overrides?.basePopulationFraction,
          d.basePopulationFraction,
          { min: 0, max: 1 },
        ),
        successRateWindow: parseNumber(
          "Fine-tune population successRateWindow",
          overrides?.successRateWindow,
          d.successRateWindow,
          { integer: true, min: 1 },
        ),
      } as RequiredFineTunePopulationConfig;
    })(),
    // Issue #1398: Structured logging configuration
    logger: (() => {
      if (options.logger) return options.logger;
      return createConsoleLogger(options.logLevel ?? "info");
    })() as Logger,
  };

  // Issue #1398: Set the global logger so code without config access can use it
  setLogger(config.logger);

  // Cross-field validation for quantum step config
  if (config.quantumStep.maxStep < config.quantumStep.minStep) {
    throw new Error(
      `Quantum step maxStep must be >= minStep. ` +
        `maxStep: ${config.quantumStep.maxStep}, minStep: ${config.quantumStep.minStep}`,
    );
  }

  // Cross-field validation for fine-tune population config
  if (
    config.fineTunePopulation.maxPopulationFraction <
      config.fineTunePopulation.minPopulationFraction
  ) {
    throw new Error(
      `Fine-tune population maxPopulationFraction must be >= minPopulationFraction. ` +
        `maxPopulationFraction: ${config.fineTunePopulation.maxPopulationFraction}, ` +
        `minPopulationFraction: ${config.fineTunePopulation.minPopulationFraction}`,
    );
  }
  if (
    config.fineTunePopulation.basePopulationFraction <
      config.fineTunePopulation.minPopulationFraction
  ) {
    throw new Error(
      `Fine-tune population basePopulationFraction must be >= minPopulationFraction. ` +
        `basePopulationFraction: ${config.fineTunePopulation.basePopulationFraction}, ` +
        `minPopulationFraction: ${config.fineTunePopulation.minPopulationFraction}`,
    );
  }
  if (
    config.fineTunePopulation.basePopulationFraction >
      config.fineTunePopulation.maxPopulationFraction
  ) {
    throw new Error(
      `Fine-tune population basePopulationFraction must be <= maxPopulationFraction. ` +
        `basePopulationFraction: ${config.fineTunePopulation.basePopulationFraction}, ` +
        `maxPopulationFraction: ${config.fineTunePopulation.maxPopulationFraction}`,
    );
  }

  validate(config);
  return Object.freeze(config);
}

function validate(config: NeatArguments) {
  // Cross-field validation not covered by parseNumber
  if (config.feedbackLoop === true && config.disableRandomSamples === false) {
    throw new Error(
      "Feedback Loop, Disable Random Samples must be set together",
    );
  }

  const adaptiveThresholds = config.adaptiveMutationThresholds;
  if (
    adaptiveThresholds.large <= adaptiveThresholds.medium
  ) {
    throw new Error(
      `Adaptive mutation large threshold must be greater than medium threshold. ` +
        `Large: ${adaptiveThresholds.large}, Medium: ${adaptiveThresholds.medium}`,
    );
  }

  const plateauDetection = config.plateauDetection;
  if (
    plateauDetection.rapidImprovementRate <=
      plateauDetection.minImprovementRate
  ) {
    throw new Error(
      `Plateau detection rapidImprovementRate must be greater than minImprovementRate. ` +
        `rapidImprovementRate: ${plateauDetection.rapidImprovementRate}, minImprovementRate: ${plateauDetection.minImprovementRate}`,
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
}
