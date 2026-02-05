import type { AdaptiveMutationThresholds } from "./AdaptiveMutationThresholds.ts";
import type { DiscoveryMinCandidatesPerCategory } from "./DiscoveryMinCandidatesPerCategory.ts";
import type { EnsembleDiversityConfig } from "./EnsembleDiversityConfig.ts";
import type { NeatArguments } from "./NeatArguments.ts";
import type { PlateauDetectionConfig } from "../NEAT/PlateauDetector.ts";
import type { StabilityAdaptationConfig } from "./StabilityAdaptationConfig.ts";
import type { WeightRegularisationConfig } from "./WeightRegularisationConfig.ts";

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
  | "geneticCompatibilityThreshold"
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
  | "discoveryReplayMinTimeMinutes";

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
    | "stabilityAdaptation"
    | "weightRegularisation"
    | "ensembleDiversity"
  >
  & {
    /** Partial overrides for minimum candidates per category (defaults applied if not specified) */
    discoveryMinCandidatesPerCategory?: DiscoveryMinCandidatesPerCategory;
    /** Partial overrides for adaptive mutation thresholds (defaults applied if not specified) */
    adaptiveMutationThresholds?: AdaptiveMutationThresholds;
    /** Partial overrides for plateau detection configuration (defaults applied if not specified) */
    plateauDetection?: PlateauDetectionConfig;
    /** Partial overrides for stability adaptation configuration (defaults applied if not specified) */
    stabilityAdaptation?: StabilityAdaptationConfig;
    /** Partial overrides for weight regularisation configuration (defaults applied if not specified) */
    weightRegularisation?: WeightRegularisationConfig;
    /** Partial overrides for ensemble diversity configuration (defaults applied if not specified) */
    ensembleDiversity?: EnsembleDiversityConfig;
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
    | "stabilityAdaptation"
    | "weightRegularisation"
    | "ensembleDiversity"
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
    stabilityAdaptation?: CoerceNumeric<StabilityAdaptationConfig>;
    weightRegularisation?: CoerceNumeric<WeightRegularisationConfig>;
    ensembleDiversity?: CoerceNumeric<EnsembleDiversityConfig>;
  };
