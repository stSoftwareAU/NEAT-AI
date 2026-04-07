import type { Logger, LogLevel } from "@utils/Logger.ts";
import type { RandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import type { TrainingEventCallback } from "@config/TrainingEvent.ts";
import type { AdaptiveMutationThresholds } from "@config/AdaptiveMutationThresholds.ts";
import type { DiscoveryMinCandidatesPerCategory } from "@config/DiscoveryMinCandidatesPerCategory.ts";
import type { EnsembleDiversityConfig } from "@config/EnsembleDiversityConfig.ts";
import type { FineTunePopulationConfig } from "@config/FineTunePopulationConfig.ts";
import type { NeatArguments } from "@config/NeatArguments.ts";
import type { PlateauDetectionConfig } from "@neat/PlateauDetector.ts";
import type { PredictiveCodingConfig } from "@config/PredictiveCodingConfig.ts";
import type { QuantumStepConfig } from "@config/QuantumStepConfig.ts";
import type { StabilityAdaptationConfig } from "@config/StabilityAdaptationConfig.ts";
import type { BiasRegularisationConfig } from "@config/BiasRegularisationConfig.ts";
import type { MemoryConfig } from "@config/MemoryConfig.ts";
import type { DiscoveryCacheConfig } from "@config/DiscoveryCacheConfig.ts";
import type { DiskSpaceConfig } from "@config/DiskSpaceConfig.ts";
import type { WasmCacheConfig } from "@config/WasmCacheConfig.ts";
import type { WeightRegularisationConfig } from "@config/WeightRegularisationConfig.ts";
import type { OutputRange } from "@config/OutputRangeConfig.ts";
import type { WorkerThreadCapConfig } from "@config/WorkerThreadCapConfig.ts";
import type { HyperparameterEvolutionConfig } from "@config/HyperparameterConfig.ts";
import type { MCMCConfig } from "@config/MCMCConfig.ts";
import type { AdaptivePopulationConfig } from "@config/AdaptivePopulationConfig.ts";
import type { CrossValidationConfig } from "@config/CrossValidationConfig.ts";
import type { DataFuzzingConfig } from "@config/DataFuzzingConfig.ts";
import type { DataQuantisationConfig } from "@config/DataQuantisationConfig.ts";
import type { ParallelEvaluationConfig } from "@config/ParallelEvaluationConfig.ts";

/** Converts number to number | string; recursively for plain numeric config objects. */
export type CoerceNumeric<T> = T extends number ? number | string
  : T extends readonly (infer _U)[] ? T
  : T extends object ? { [K in keyof T]: CoerceNumeric<T[K]> }
  : T;

/** Keys that are numeric scalars from CLI - coerce to allow string. Non-numeric/complex types are omitted. */
type NumericOptionKeys =
  | "creativeThinkingConnectionCount"
  | "dataSetPartitionBreak"
  | "trainingSampleRate"
  | "focusRate"
  | "targetError"
  | "costOfGrowth"
  | "iterations"
  | "populationSize"
  | "elitism"
  | "maxConns"
  | "maximumNumberOfNodes"
  | "mutationRate"
  | "mutationAmount"
  | "timeoutMinutes"
  | "trainPerGen"
  | "log"
  | "trainingBatchSize"
  | "threads"
  | "maximumBiasAdjustmentScale"
  | "maximumWeightAdjustmentScale"
  | "sparseRatio"
  | "globalBreedingRate"
  | "diversityBreedingRate"
  | "geneticCompatibilityThreshold"
  | "interSpeciesCrossoverThreshold"
  | "discoverySampleRate"
  | "discoveryRecordTimeOutMinutes"
  | "discoveryAnalysisTimeoutMinutes"
  | "discoveryBatchSize"
  | "discoveryBufferSize"
  | "discoveryRustFlushRecords"
  | "discoveryRustFlushBytes"
  | "discoveryMaxNeurons"
  | "discoveryDrainEveryNBatches"
  | "discoveryReplayMaxSingles"
  | "discoveryReplayMaxPairwise"
  | "discoveryReplayMaxTriples"
  | "discoveryReplayConcurrency"
  | "discoveryReplayTimeoutMinutes"
  | "discoveryReplayMinTimeMinutes"
  | "maxCRISPRsPerGeneration";

/**
 * Options for NEAT configuration.
 * All properties are optional; defaults are applied in createNeatConfig().
 * For discoveryMinCandidatesPerCategory, adaptiveMutationThresholds, plateauDetection,
 * and stabilityAdaptation, you can specify partial overrides and defaults will be merged in.
 */
export type NeatOptions =
  & Omit<
    Partial<NeatArguments>,
    | "discoveryMinCandidatesPerCategory"
    | "adaptiveMutationThresholds"
    | "plateauDetection"
    | "predictiveCoding"
    | "stabilityAdaptation"
    | "weightRegularisation"
    | "biasRegularisation"
    | "ensembleDiversity"
    | "quantumStep"
    | "fineTunePopulation"
    | "discoveryCache"
    | "discoveryDiskSpace"
    | "wasmCache"
    | "memory"
    | "workerThreadCap"
    | "hyperparameterEvolution"
    | "mcmc"
    | "adaptivePopulation"
    | "crossValidation"
    | "dataFuzzing"
    | "dataQuantisation"
    | "parallelEvaluation"
    | "outputRanges"
    | "logger"
    | "rng"
    | "onTrainingEvent"
  >
  & {
    /** Partial overrides for minimum candidates per category (defaults applied if not specified) */
    discoveryMinCandidatesPerCategory?: DiscoveryMinCandidatesPerCategory;
    /** Partial overrides for adaptive mutation thresholds (defaults applied if not specified) */
    adaptiveMutationThresholds?: AdaptiveMutationThresholds;
    /** Partial overrides for plateau detection configuration (defaults applied if not specified) */
    plateauDetection?: PlateauDetectionConfig;
    /** Partial overrides for Predictive Coding configuration (defaults applied if not specified) */
    predictiveCoding?: PredictiveCodingConfig;
    /** Partial overrides for stability adaptation configuration (defaults applied if not specified) */
    stabilityAdaptation?: StabilityAdaptationConfig;
    /** Partial overrides for weight regularisation configuration (defaults applied if not specified) */
    weightRegularisation?: WeightRegularisationConfig;
    /** Partial overrides for bias regularisation configuration (defaults applied if not specified) */
    biasRegularisation?: BiasRegularisationConfig;
    /** Partial overrides for ensemble diversity configuration (defaults applied if not specified) */
    ensembleDiversity?: EnsembleDiversityConfig;
    /** Partial overrides for quantum step configuration (defaults applied if not specified) */
    quantumStep?: QuantumStepConfig;
    /** Partial overrides for fine-tune population configuration (defaults applied if not specified) */
    fineTunePopulation?: FineTunePopulationConfig;
    /** Partial overrides for discovery cache eviction configuration (defaults applied if not specified) */
    discoveryCache?: DiscoveryCacheConfig;
    /** Partial overrides for discovery disk space monitoring configuration (defaults applied if not specified) */
    discoveryDiskSpace?: DiskSpaceConfig;
    /** Partial overrides for WASM cache configuration (defaults applied if not specified) */
    wasmCache?: WasmCacheConfig;
    /** Partial overrides for memory monitoring configuration (defaults applied if not specified) */
    memory?: MemoryConfig;
    /** Partial overrides for worker thread cap configuration (defaults applied if not specified) */
    workerThreadCap?: WorkerThreadCapConfig;
    /** Partial overrides for hyperparameter evolution configuration (defaults applied if not specified) */
    hyperparameterEvolution?: HyperparameterEvolutionConfig;
    /** Partial overrides for MCMC acceptance configuration (defaults applied if not specified) */
    mcmc?: MCMCConfig;
    /** Partial overrides for adaptive population sizing configuration (defaults applied if not specified) */
    adaptivePopulation?: AdaptivePopulationConfig;
    /** Partial overrides for cross-validation configuration (defaults applied if not specified) */
    crossValidation?: CrossValidationConfig;
    /** Partial overrides for data fuzzing configuration (defaults applied if not specified) */
    dataFuzzing?: DataFuzzingConfig;
    /** Partial overrides for data quantisation configuration (defaults applied if not specified) */
    dataQuantisation?: DataQuantisationConfig;
    /** Partial overrides for parallel evaluation configuration (defaults applied if not specified) */
    parallelEvaluation?: ParallelEvaluationConfig;
    /**
     * Optional per-output range constraints (Issue #1620).
     *
     * When specified, creatures that produce outputs outside these ranges
     * receive a fitness penalty proportional to the excess. Each element
     * corresponds to one output neuron, in order.
     */
    outputRanges?: readonly OutputRange[];
    /**
     * Custom logger instance. When provided, all NEAT-AI log output is
     * routed through this logger instead of the default console logger.
     */
    logger?: Logger;
    /**
     * Log level filter when using the default console logger.
     * Ignored when a custom `logger` is provided.
     * Default: "info"
     */
    logLevel?: LogLevel;
    /**
     * Seed for reproducible random number generation.
     *
     * Issue #1400: When provided, all stochastic operations (mutation,
     * selection, breeding, shuffling) use a deterministic xoshiro256**
     * PRNG seeded with this value. Two runs with the same seed and
     * configuration produce identical results.
     *
     * When omitted, an unseeded RNG backed by `Math.random()` is used
     * for backward compatibility.
     */
    seed?: number;
    /**
     * Custom random number generator instance.
     *
     * Issue #1400: Advanced users can inject their own RNG implementation.
     * Takes precedence over `seed` when both are provided.
     */
    rng?: RandomNumberGenerator;
    /**
     * Optional callback for structured training lifecycle events.
     *
     * Issue #1615: When provided, this callback is invoked for each
     * lifecycle event (generation completion, plateau detection, discovery
     * outcomes, memory pressure, species adjustments). The callback is
     * fire-and-forget; exceptions are silently caught. When not provided,
     * no event overhead is incurred.
     */
    onTrainingEvent?: TrainingEventCallback;
  };

/**
 * Input options for createNeatConfig(), accepting unvalidated values from CLI/env.
 *
 * Numeric fields accept `string | number` so you can pass values directly from
 * bash scripts, argv, env vars, etc. without pre-parsing. createNeatConfig()
 * parses and validates everything; do not trust input until you have a NeatConfig.
 *
 * @example
 * ```ts
 * // From CLI arguments (unvalidated)
 * const config = createNeatConfig({
 *   trainingSampleRate: process.env.SAMPLE_RATE ?? "0.5",
 *   populationSize: parseInt(process.argv[2] ?? "50", 10),
 *   targetError: "0.05",
 * });
 * ```
 */
export type NeatOptionsInput =
  & Omit<
    NeatOptions,
    | NumericOptionKeys
    | "discoveryMinCandidatesPerCategory"
    | "adaptiveMutationThresholds"
    | "plateauDetection"
    | "predictiveCoding"
    | "stabilityAdaptation"
    | "weightRegularisation"
    | "biasRegularisation"
    | "ensembleDiversity"
    | "quantumStep"
    | "fineTunePopulation"
    | "discoveryCache"
    | "discoveryDiskSpace"
    | "wasmCache"
    | "memory"
    | "workerThreadCap"
    | "hyperparameterEvolution"
    | "mcmc"
    | "adaptivePopulation"
    | "crossValidation"
    | "dataFuzzing"
    | "dataQuantisation"
    | "parallelEvaluation"
    | "outputRanges"
    | "logger"
    | "logLevel"
    | "seed"
    | "rng"
    | "onTrainingEvent"
  >
  & {
    [K in NumericOptionKeys]?: NonNullable<NeatOptions[K]> extends number
      ? number | string
      : NeatOptions[K];
  }
  & {
    discoveryMinCandidatesPerCategory?: CoerceNumeric<
      DiscoveryMinCandidatesPerCategory
    >;
    adaptiveMutationThresholds?: CoerceNumeric<AdaptiveMutationThresholds>;
    plateauDetection?: CoerceNumeric<PlateauDetectionConfig>;
    predictiveCoding?: CoerceNumeric<PredictiveCodingConfig>;
    stabilityAdaptation?: CoerceNumeric<StabilityAdaptationConfig>;
    weightRegularisation?: CoerceNumeric<WeightRegularisationConfig>;
    biasRegularisation?: CoerceNumeric<BiasRegularisationConfig>;
    ensembleDiversity?: CoerceNumeric<EnsembleDiversityConfig>;
    quantumStep?: CoerceNumeric<QuantumStepConfig>;
    fineTunePopulation?: CoerceNumeric<FineTunePopulationConfig>;
    discoveryCache?: CoerceNumeric<DiscoveryCacheConfig>;
    discoveryDiskSpace?: CoerceNumeric<DiskSpaceConfig>;
    wasmCache?: CoerceNumeric<WasmCacheConfig>;
    memory?: CoerceNumeric<MemoryConfig>;
    workerThreadCap?: CoerceNumeric<WorkerThreadCapConfig>;
    hyperparameterEvolution?: CoerceNumeric<HyperparameterEvolutionConfig>;
    /** MCMC acceptance configuration (Issue #2199). Numeric fields coerced from CLI. */
    mcmc?: CoerceNumeric<MCMCConfig>;
    adaptivePopulation?: CoerceNumeric<AdaptivePopulationConfig>;
    /** Cross-validation configuration (Issue #1865). Numeric fields coerced from CLI. */
    crossValidation?: CoerceNumeric<CrossValidationConfig>;
    /** Data fuzzing configuration (Issue #1900). Numeric fields coerced from CLI. */
    dataFuzzing?: CoerceNumeric<DataFuzzingConfig>;
    /** Data quantisation configuration (Issue #1901). Numeric fields coerced from CLI. */
    dataQuantisation?: CoerceNumeric<DataQuantisationConfig>;
    /** Parallel evaluation configuration (Issue #1862). Numeric fields coerced from CLI. */
    parallelEvaluation?: CoerceNumeric<ParallelEvaluationConfig>;
    /** Per-output range constraints (Issue #1620). Numeric fields coerced from CLI. */
    outputRanges?: readonly CoerceNumeric<OutputRange>[];
    /** Custom logger instance (not coerced — functions cannot come from CLI). */
    logger?: Logger;
    /** Log level filter for the default console logger. */
    logLevel?: LogLevel;
    /** Seed for reproducible random number generation. Accepts string from CLI. */
    seed?: number | string;
    /** Custom RNG instance (not coerced — functions cannot come from CLI). */
    rng?: RandomNumberGenerator;
    /** Optional callback for structured training lifecycle events (Issue #1615). */
    onTrainingEvent?: TrainingEventCallback;
  };
