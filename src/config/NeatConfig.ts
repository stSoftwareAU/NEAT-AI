/**
 * NeatConfig.ts - NEAT configuration factory and constants.
 *
 * Issue #1599: Refactored from 1,120 lines into a ~500-line factory.
 * Sub-config parsing is delegated to NeatConfigParsers.ts and
 * cross-field validation to NeatConfigValidation.ts.
 */

import type { NeatOptionsInput } from "@config/NeatOptions.ts";
import { getGlobalDebug } from "@globalAccessors";
import {
  DEFAULT_RUST_FLUSH_BYTES,
  DEFAULT_RUST_FLUSH_RECORDS,
} from "@architecture/ErrorGuidedStructuralEvolution/constants.ts";
import { Selection, type SelectionInterface } from "@methods/Selection.ts";
import { Mutation } from "@neat/Mutation.ts";
import type { DiscoveryMinCandidatesPerCategory } from "@config/DiscoveryMinCandidatesPerCategory.ts";
import type { NeatArguments } from "@config/NeatArguments.ts";
import { parseDiscoverySampleRate, parseNumber } from "@config/ParseOptions.ts";
import { resolveDefaultTrainPerGen } from "@config/TrainPerGen.ts";
import {
  createConsoleLogger,
  getLogger,
  type Logger,
  setLogger,
} from "@utils/Logger.ts";
import {
  createSeededRng,
  createUnseededRng,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { Activations } from "@methods/activations/Activations.ts";

import {
  DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT,
  type RequiredOutputRange,
} from "@config/OutputRangeConfig.ts";

// Extracted sub-config parsers
import {
  parseAdaptiveMutationThresholds,
  parseAdaptivePopulation,
  parseBiasRegularisation,
  parseCompatibilityGating,
  parseCrossValidation,
  parseDataFuzzing,
  parseDataQuantisation,
  parseDiscoveryCache,
  parseDiscoveryMinCandidates,
  parseDiskSpaceConfig,
  parseFineTunePopulation,
  parseFitnessSharing,
  parseHyperparameterEvolution,
  parseMcmc,
  parseMemoryConfig,
  parseNovelty,
  parseOpd,
  parseParallelEvaluation,
  parsePlateauDetection,
  parsePredictiveCoding,
  parseQuantumStep,
  parseRandomImmigrants,
  parseSelectionPressure,
  parseSpecialist,
  parseSpeciesStagnation,
  parseSquashBudget,
  parseSquashEffectiveness,
  parseStabilityAdaptation,
  parseWasmCache,
  parseWeightRegularisation,
  parseWorkerThreadCap,
} from "@config/NeatConfigParsers.ts";

// Extracted cross-field validation
import { validateNeatConfig } from "@config/NeatConfigValidation.ts";

// Automatic Discovery worker-memory envelope → workerThreadCap wiring.
import {
  mergeDiscoveryWorkerThreadCapDefaults,
  resolveDiscoveryWorkerThreadCap,
} from "@config/DiscoveryWorkerEnvelope.ts";

// Issue #2492: DNA-sharing knob preset
import {
  type DnaSharingMode,
  getDnaSharingPreset,
} from "@config/DnaSharingPreset.ts";

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
 * Default minimum record-phase coverage fraction (Issue #3073).
 *
 * When the record phase times out having sampled less than this fraction of
 * the dataset, the analysis phase is skipped with a clear reason rather than
 * running on sparse partial data (which produced zero-candidate passes on
 * GRQ-3's 520-file dataset). Only fires on a genuine timeout that left part of
 * a multi-file dataset unread; recordings that finish normally are unaffected.
 * Set `discoveryMinRecordCoverage` to 0 to disable the guard.
 */
export const DEFAULT_DISCOVERY_MIN_RECORD_COVERAGE = 0.5;

/**
 * Issue #3053: Default per-training-task wall-clock cap (minutes). Bounds a
 * single training task well under the 10–13 minute runaways observed in
 * production while leaving headroom for legitimate single-pass training. Set
 * `trainingTaskTimeoutMinutes` to 0 to disable the cap.
 */
export const DEFAULT_TRAINING_TASK_TIMEOUT_MINUTES = 5;

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
 * Default workers reserved for discovery and training (Issue #2243).
 *
 * Issue #2244: Default total `threads` is `hardwareConcurrency +` this value
 * so the fast pool (fitness) has at least one worker per logical CPU by default.
 */
export const DEFAULT_HEAVY_TASK_WORKER_COUNT = 2;

/**
 * Interface for NEAT training options.
 * Provides a read-only configuration object for the NEAT algorithm.
 */
export type NeatConfig = Readonly<NeatArguments>;

/**
 * Merge per-knob defaults from a DNA-sharing preset into the user's
 * `compatibilityGating` overrides (Issue #2492). Returns a new object
 * where preset values fill in any field the user did not supply, so the
 * downstream `parseCompatibilityGating` parser sees mode-aware defaults.
 *
 * Internal helper — exported only for unit testing the merge semantics.
 */
function mergeCompatibilityGatingDefaults(
  userOverrides: Record<string, unknown> | undefined,
  presetDefaults: { enabled: boolean; power: number; maxDraws: number },
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    enabled: presetDefaults.enabled,
    power: presetDefaults.power,
    maxDraws: presetDefaults.maxDraws,
  };
  if (userOverrides) {
    if (userOverrides.enabled !== undefined) {
      merged.enabled = userOverrides.enabled;
    }
    if (userOverrides.power !== undefined) merged.power = userOverrides.power;
    if (userOverrides.maxDraws !== undefined) {
      merged.maxDraws = userOverrides.maxDraws;
    }
  }
  return merged;
}

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

  // Issue #3263: apply the opt-in squash budget before any squash is drawn so
  // mutation and neuron creation can never introduce a disallowed activation.
  // Unknown squash names fail loud here (fail loud, Issue #3234).
  const squashBudget = parseSquashBudget(
    opts.squashBudget as Record<string, unknown> | undefined,
  );
  Activations.setAllowedSquashes(squashBudget.allowedSquashes);

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

  const coreCount = Math.max(1, navigator.hardwareConcurrency ?? 1);
  const defaultThreads = coreCount + DEFAULT_HEAVY_TASK_WORKER_COUNT;
  let threads = parseNumber("Threads", opts.threads, defaultThreads, {
    integer: true,
    min: 1,
  });

  // Issue #1569: Parse worker thread cap config and apply memory-based capping.
  // When the external production runner exports a host-derived worker-memory
  // envelope (DISCOVERY_WORKER_ENVELOPE_MB) and per-worker V8 budget, wire them in
  // automatically so the cap fires without any per-caller opt-in. Explicit user
  // overrides still win; non-Discovery callers (env unset) keep the cap disabled.
  const workerThreadCap = parseWorkerThreadCap(
    mergeDiscoveryWorkerThreadCapDefaults(
      opts.workerThreadCap as Record<string, unknown> | undefined,
      resolveDiscoveryWorkerThreadCap(),
    ),
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
      getLogger().warn(
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

  // Issue #2791: the default `trainPerGen` scales with the population for
  // supervised costs so gradient descent is not starved (one creature per
  // generation). Custom / evolution-only costs keep the conservative default
  // of 1. Explicit `opts.trainPerGen` always wins via `parseNumber` below.
  const costName = options.costName ?? "MSE";
  const defaultTrainPerGen = resolveDefaultTrainPerGen(
    populationSize,
    costName,
  );

  // Issue #2492: Resolve the DNA-sharing knob preset before parsing the
  // five inter-island knobs so the preset can supply mode-aware defaults.
  // Explicit user values still win over the preset default — `parseNumber`
  // only reaches the default when `opts.<knob>` is undefined.
  const dnaSharingMode: DnaSharingMode = opts.dnaSharingMode === "aggressive"
    ? "aggressive"
    : "default";
  const dnaPreset = getDnaSharingPreset(dnaSharingMode);

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
    costName,
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
    trainPerGen: parseNumber(
      "Training per generation",
      opts.trainPerGen,
      defaultTrainPerGen,
      {
        integer: true,
        min: 0,
      },
    ),

    // Issue #3053: cap the wall-clock budget of any single training task so a
    // stuck task cannot consume the entire remaining run. Default 5 minutes;
    // 0 disables the cap (full remaining run budget).
    trainingTaskTimeoutMinutes: parseNumber(
      "Training Task Timeout Minutes",
      opts.trainingTaskTimeoutMinutes,
      DEFAULT_TRAINING_TASK_TIMEOUT_MINUTES,
      { min: 0 },
    ),

    log: parseNumber("Log", opts.log, options.verbose ? 1 : 0, {
      integer: true,
      min: 0,
    }),
    verbose: options.verbose ? true : false,

    // Issue #2382: skip training for a creature whose last N attempts all
    // produced a higher error and no usable fine-tune variant. Default of 2
    // means a creature must regress twice in a row before it is bypassed.
    skipTrainingAfterConsecutiveRegressions: parseNumber(
      "Skip Training After Consecutive Regressions",
      opts.skipTrainingAfterConsecutiveRegressions,
      2,
      { integer: true, min: 0 },
    ),

    // Issue #2531: bounded LRU size for the subnetwork hash index. Default
    // 50,000 mirrors the failure-cache size order. Set to 0 to disable.
    subnetworkIndexSize: parseNumber(
      "Subnetwork Index Size",
      opts.subnetworkIndexSize,
      50_000,
      { integer: true, min: 0 },
    ),

    trainingBatchSize: parseNumber(
      "Training Batch Size",
      opts.trainingBatchSize,
      100,
      { integer: true, min: 1 },
    ),
    threads,

    heavyTaskWorkerCount: parseNumber(
      "Heavy Task Worker Count",
      opts.heavyTaskWorkerCount,
      DEFAULT_HEAVY_TASK_WORKER_COUNT,
      { integer: true, min: 1 },
    ),

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
    diversityBreedingRate: parseNumber(
      "Diversity breeding rate",
      opts.diversityBreedingRate,
      dnaPreset.diversityBreedingRate,
      { min: 0, max: 1 },
    ),
    CRISPRs: options.CRISPRs || [],
    maxDedupRetries: parseNumber(
      "Max dedup retries",
      opts.maxDedupRetries,
      16,
      { integer: true, min: 1 },
    ),
    maxCRISPRsPerGeneration: parseNumber(
      "Max CRISPRs per generation",
      opts.maxCRISPRsPerGeneration,
      1,
      { integer: true, min: 1 },
    ),
    geneticCompatibilityThreshold: parseNumber(
      "Genetic Compatibility Threshold",
      opts.geneticCompatibilityThreshold,
      dnaPreset.geneticCompatibilityThreshold,
      { min: 0, max: 1 },
    ),
    interSpeciesCrossoverThreshold: parseNumber(
      "Inter-species Crossover Threshold",
      opts.interSpeciesCrossoverThreshold,
      dnaPreset.interSpeciesCrossoverThreshold,
      { min: 0, max: 1 },
    ),
    syntheticAlignmentThreshold: parseNumber(
      "Synthetic Alignment Threshold",
      opts.syntheticAlignmentThreshold,
      0.2,
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
    discoveryMinRecordCoverage: parseNumber(
      "Discovery minimum record coverage",
      opts.discoveryMinRecordCoverage,
      DEFAULT_DISCOVERY_MIN_RECORD_COVERAGE,
      { min: 0, max: 1 },
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
    discoveryAnalysisChunkSize: parseNumber(
      "Discovery analysis chunk size",
      opts.discoveryAnalysisChunkSize,
      2,
      { integer: true, min: 0 },
    ),
    discoveryAnalysisPerChunkMaxMs: parseNumber(
      "Discovery analysis per-chunk max milliseconds",
      opts.discoveryAnalysisPerChunkMaxMs,
      120_000,
      { min: 0 },
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
    discoveryFailureCacheBypassOnDrought:
      options.discoveryFailureCacheBypassOnDrought ?? true,
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
    predictiveCoding: parsePredictiveCoding(
      opts.predictiveCoding as Record<string, unknown> | undefined,
    ),
    discoveryCache: parseDiscoveryCache(
      opts.discoveryCache as Record<string, unknown> | undefined,
    ),
    discoveryDiskSpace: parseDiskSpaceConfig(
      opts.discoveryDiskSpace as Record<string, unknown> | undefined,
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
    maxConcurrentDiscoveries: parseNumber(
      "Max Concurrent Discoveries",
      opts.maxConcurrentDiscoveries,
      1,
      { integer: true, min: 1 },
    ),
    // Issue #2329: Allow idle fast workers to be borrowed for heavy tasks
    allowPoolBorrowing: options.allowPoolBorrowing !== false,

    // Issue #2199: Parse MCMC acceptance configuration
    mcmc: parseMcmc(
      opts.mcmc as Record<string, unknown> | undefined,
    ),
    // Issue #2528: Parse On-Policy Distillation breeding operator configuration
    opd: parseOpd(
      opts.opd as Record<string, unknown> | undefined,
    ),
    // Issue #2530: Parse specialist sub-population pipeline configuration
    specialist: parseSpecialist(
      opts.specialist as Record<string, unknown> | undefined,
    ),
    // Issue #1863: Parse hyperparameter evolution and adaptive population configs
    hyperparameterEvolution: parseHyperparameterEvolution(
      opts.hyperparameterEvolution as Record<string, unknown> | undefined,
    ),
    adaptivePopulation: parseAdaptivePopulation(
      opts.adaptivePopulation as Record<string, unknown> | undefined,
    ),
    // Issue #1865: Parse cross-validation configuration
    crossValidation: parseCrossValidation(
      opts.crossValidation as Record<string, unknown> | undefined,
    ),
    // Issue #1900: Parse data fuzzing configuration
    dataFuzzing: parseDataFuzzing(
      opts.dataFuzzing as Record<string, unknown> | undefined,
    ),
    // Issue #1901: Parse data quantisation configuration
    dataQuantisation: parseDataQuantisation(
      opts.dataQuantisation as Record<string, unknown> | undefined,
    ),
    // Issue #1862: Parse parallel evaluation configuration
    parallelEvaluation: parseParallelEvaluation(
      opts.parallelEvaluation as Record<string, unknown> | undefined,
    ),
    // Issue #2457: Parse squash effectiveness tracker configuration
    squashEffectiveness: parseSquashEffectiveness(
      opts.squashEffectiveness as Record<string, unknown> | undefined,
    ),
    // Issue #3263: opt-in squash budget (already applied to the global
    // activation registry above); stored so the config is self-describing.
    squashBudget,
    // Issue #2453: Parse fitness sharing configuration
    fitnessSharing: parseFitnessSharing(
      opts.fitnessSharing as Record<string, unknown> | undefined,
    ),
    // Issue #2932: Parse novelty (behavioural-diversity) configuration
    novelty: parseNovelty(
      opts.novelty as Record<string, unknown> | undefined,
    ),
    // Issue #2933: Parse random-immigrants configuration
    randomImmigrants: parseRandomImmigrants(
      opts.randomImmigrants as Record<string, unknown> | undefined,
    ),
    // Issue #2454: Parse species stagnation configuration
    speciesStagnation: parseSpeciesStagnation(
      opts.speciesStagnation as Record<string, unknown> | undefined,
    ),
    // Issue #2455: Parse compatibility gating configuration
    // Issue #2492: Apply DNA-sharing preset defaults to any field the user
    // did not set explicitly. The preset overrides only the *defaults*;
    // user-supplied values still take precedence.
    compatibilityGating: parseCompatibilityGating(
      mergeCompatibilityGatingDefaults(
        opts.compatibilityGating as Record<string, unknown> | undefined,
        dnaPreset.compatibilityGating,
      ),
    ),

    // Issue #2929: Parse selection-pressure configuration (POWER exponent,
    // tournament size/probability, adaptive-tournament bounds).
    selectionPressure: parseSelectionPressure(
      opts.selectionPressure as Record<string, unknown> | undefined,
    ),

    // Issue #2492: Knob-tuning preset for inter-island DNA sharing.
    dnaSharingMode,

    // Issue #2523: Tolerate corrupt parents during breeding by default.
    // Setting `false` restores legacy fail-fast behaviour.
    tolerateCorruptParents: options.tolerateCorruptParents !== false,
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
