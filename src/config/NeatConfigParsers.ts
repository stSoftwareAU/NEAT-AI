/**
 * NeatConfigParsers.ts - Sub-config parsing functions for NeatConfig.
 *
 * Extracted from NeatConfig.ts (Issue #1599) to keep the configuration
 * factory under 500 lines. Each function parses a nested config section
 * from user-provided options using parseNumber for validation.
 */

import {
  DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS,
  type RequiredAdaptiveMutationThresholds,
} from "@config/AdaptiveMutationThresholds.ts";
import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
  type RequiredBiasRegularisationConfig,
} from "@config/BiasRegularisationConfig.ts";
import {
  DEFAULT_DISCOVERY_CACHE_CONFIG,
  type RequiredDiscoveryCacheConfig,
} from "@config/DiscoveryCacheConfig.ts";
import {
  DEFAULT_DISK_SPACE_CONFIG,
  type RequiredDiskSpaceConfig,
} from "@config/DiskSpaceConfig.ts";
import type { DiscoveryMinCandidatesPerCategory } from "@config/DiscoveryMinCandidatesPerCategory.ts";
import {
  DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
  type RequiredEnsembleDiversityConfig,
} from "@config/EnsembleDiversityConfig.ts";
import {
  DEFAULT_FINE_TUNE_POPULATION_CONFIG,
  type RequiredFineTunePopulationConfig,
} from "@config/FineTunePopulationConfig.ts";
import {
  DEFAULT_MEMORY_CONFIG,
  type RequiredMemoryConfig,
} from "@config/MemoryConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";
import {
  DEFAULT_PREDICTIVE_CODING_CONFIG,
  type RequiredPredictiveCodingConfig,
} from "@config/PredictiveCodingConfig.ts";
import {
  DEFAULT_QUANTUM_STEP_CONFIG,
  type RequiredQuantumStepConfig,
} from "@config/QuantumStepConfig.ts";
import {
  DEFAULT_STABILITY_ADAPTATION_CONFIG,
  type RequiredStabilityAdaptationConfig,
} from "@config/StabilityAdaptationConfig.ts";
import {
  DEFAULT_WASM_CACHE_CONFIG,
  type RequiredWasmCacheConfig,
} from "@config/WasmCacheConfig.ts";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  type RequiredWeightRegularisationConfig,
} from "@config/WeightRegularisationConfig.ts";
import {
  DEFAULT_WORKER_THREAD_CAP_CONFIG,
  type RequiredWorkerThreadCapConfig,
} from "@config/WorkerThreadCapConfig.ts";
import {
  DEFAULT_PLATEAU_DETECTION,
  type RequiredPlateauDetectionConfig,
} from "@neat/PlateauDetector.ts";
import { DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY } from "@config/NeatConfig.ts";
import {
  DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
  type RequiredHyperparameterEvolutionConfig,
} from "@config/HyperparameterConfig.ts";
import {
  DEFAULT_MCMC_CONFIG,
  type RequiredMCMCConfig,
} from "@config/MCMCConfig.ts";
import {
  DEFAULT_ADAPTIVE_POPULATION_CONFIG,
  type RequiredAdaptivePopulationConfig,
} from "@config/AdaptivePopulationConfig.ts";
import {
  DEFAULT_CROSS_VALIDATION_CONFIG,
  type RequiredCrossValidationConfig,
} from "@config/CrossValidationConfig.ts";
import {
  DEFAULT_DATA_FUZZING_CONFIG,
  type RequiredDataFuzzingConfig,
} from "@config/DataFuzzingConfig.ts";
import {
  DEFAULT_DATA_QUANTISATION_CONFIG,
  type RequiredDataQuantisationConfig,
} from "@config/DataQuantisationConfig.ts";
import {
  DEFAULT_PARALLEL_EVALUATION_CONFIG,
  type RequiredParallelEvaluationConfig,
} from "@config/ParallelEvaluationConfig.ts";

/** Parse worker thread cap configuration (Issue #1569). */
export function parseWorkerThreadCap(
  overrides: Record<string, unknown> | undefined,
): RequiredWorkerThreadCapConfig {
  const d = DEFAULT_WORKER_THREAD_CAP_CONFIG;
  return {
    maxMemoryMB: parseNumber(
      "Worker thread cap maxMemoryMB",
      overrides?.maxMemoryMB,
      d.maxMemoryMB,
      { min: 0 },
    ),
    estimatedMemoryPerWorkerMB: parseNumber(
      "Worker thread cap estimatedMemoryPerWorkerMB",
      overrides?.estimatedMemoryPerWorkerMB,
      d.estimatedMemoryPerWorkerMB,
      { min: 1 },
    ),
  } as RequiredWorkerThreadCapConfig;
}

/** Parse discovery minimum candidates per category. */
export function parseDiscoveryMinCandidates(
  overrides: Record<string, unknown> | undefined,
): Required<DiscoveryMinCandidatesPerCategory> {
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
}

/** Parse adaptive mutation thresholds. */
export function parseAdaptiveMutationThresholds(
  overrides: Record<string, unknown> | undefined,
): RequiredAdaptiveMutationThresholds {
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
}

/** Parse plateau detection configuration (Issue #1039). */
export function parsePlateauDetection(
  overrides: Record<string, unknown> | undefined,
): RequiredPlateauDetectionConfig {
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
}

/** Parse stability adaptation configuration (Issue #1307). */
export function parseStabilityAdaptation(
  overrides: Record<string, unknown> | undefined,
): RequiredStabilityAdaptationConfig {
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
}

/** Parse weight regularisation configuration (Issue #1309). */
export function parseWeightRegularisation(
  overrides: Record<string, unknown> | undefined,
): RequiredWeightRegularisationConfig {
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
}

/** Parse bias regularisation configuration (Issue #1416). */
export function parseBiasRegularisation(
  overrides: Record<string, unknown> | undefined,
): RequiredBiasRegularisationConfig {
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
}

/** Parse ensemble diversity configuration (Issue #1310). */
export function parseEnsembleDiversity(
  overrides: Record<string, unknown> | undefined,
): RequiredEnsembleDiversityConfig {
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
}

/** Parse predictive coding configuration (Issue #1553). */
export function parsePredictiveCoding(
  overrides: Record<string, unknown> | undefined,
): RequiredPredictiveCodingConfig {
  const d = DEFAULT_PREDICTIVE_CODING_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    inferenceSteps: parseNumber(
      "Predictive Coding inferenceSteps",
      overrides?.inferenceSteps,
      d.inferenceSteps,
      { integer: true, min: 1 },
    ),
    inferenceRate: parseNumber(
      "Predictive Coding inferenceRate",
      overrides?.inferenceRate,
      d.inferenceRate,
      { minExclusive: 0 },
    ),
    learningRate: parseNumber(
      "Predictive Coding learningRate",
      overrides?.learningRate,
      d.learningRate,
      { minExclusive: 0 },
    ),
    energyThreshold: parseNumber(
      "Predictive Coding energyThreshold",
      overrides?.energyThreshold,
      d.energyThreshold,
      { minExclusive: 0 },
    ),
  } as RequiredPredictiveCodingConfig;
}

/** Parse WASM cache configuration (Issue #1566). */
export function parseWasmCache(
  overrides: Record<string, unknown> | undefined,
  populationSize: number,
): RequiredWasmCacheConfig {
  const d = DEFAULT_WASM_CACHE_CONFIG;
  return {
    maxCachedActivations: parseNumber(
      "WASM cache maxCachedActivations",
      overrides?.maxCachedActivations,
      populationSize * 2,
      { integer: true, min: 1 },
    ),
    compilationCacheSize: parseNumber(
      "WASM cache compilationCacheSize",
      overrides?.compilationCacheSize,
      d.compilationCacheSize,
      { integer: true, min: 1 },
    ),
  } as RequiredWasmCacheConfig;
}

/** Parse memory monitoring configuration (Issue #1565). */
export function parseMemoryConfig(
  overrides: Record<string, unknown> | undefined,
): RequiredMemoryConfig {
  const d = DEFAULT_MEMORY_CONFIG;
  const enabled = overrides?.enabled !== undefined
    ? Boolean(overrides.enabled)
    : d.enabled;
  return {
    enabled,
    warningThreshold: parseNumber(
      "Memory warningThreshold",
      overrides?.warningThreshold,
      d.warningThreshold,
      { min: 0, max: 1 },
    ),
    criticalThreshold: parseNumber(
      "Memory criticalThreshold",
      overrides?.criticalThreshold,
      d.criticalThreshold,
      { min: 0, max: 1 },
    ),
  } as RequiredMemoryConfig;
}

/** Parse quantum step configuration (Issue #1330). */
export function parseQuantumStep(
  overrides: Record<string, unknown> | undefined,
): RequiredQuantumStepConfig {
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
}

/** Parse discovery cache eviction configuration (Issue #1701). */
export function parseDiscoveryCache(
  overrides: Record<string, unknown> | undefined,
): RequiredDiscoveryCacheConfig {
  const d = DEFAULT_DISCOVERY_CACHE_CONFIG;
  return {
    successMaxEntries: parseNumber(
      "Discovery cache successMaxEntries",
      overrides?.successMaxEntries,
      d.successMaxEntries,
      { integer: true, min: 1 },
    ),
    failureMaxEntries: parseNumber(
      "Discovery cache failureMaxEntries",
      overrides?.failureMaxEntries,
      d.failureMaxEntries,
      { integer: true, min: 1 },
    ),
    ttlDays: parseNumber(
      "Discovery cache ttlDays",
      overrides?.ttlDays,
      d.ttlDays,
      { min: 0.001 },
    ),
    obsoleteTTLDays: parseNumber(
      "Discovery cache obsoleteTTLDays",
      overrides?.obsoleteTTLDays,
      d.obsoleteTTLDays,
      { min: 0.001 },
    ),
  } as RequiredDiscoveryCacheConfig;
}

/** Parse discovery disk space monitoring configuration (Issue #1703). */
export function parseDiskSpaceConfig(
  overrides: Record<string, unknown> | undefined,
): RequiredDiskSpaceConfig {
  const d = DEFAULT_DISK_SPACE_CONFIG;
  return {
    enabled: overrides?.enabled !== undefined
      ? Boolean(overrides.enabled)
      : d.enabled,
    minFreeDiskMB: parseNumber(
      "Disk space minFreeDiskMB",
      overrides?.minFreeDiskMB,
      d.minFreeDiskMB,
      { min: 0 },
    ),
    criticalFreeDiskMB: parseNumber(
      "Disk space criticalFreeDiskMB",
      overrides?.criticalFreeDiskMB,
      d.criticalFreeDiskMB,
      { min: 0 },
    ),
  } as RequiredDiskSpaceConfig;
}

/** Parse fine-tune population configuration (Issue #1323). */
export function parseFineTunePopulation(
  overrides: Record<string, unknown> | undefined,
): RequiredFineTunePopulationConfig {
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
}

/** Parse hyperparameter evolution configuration (Issue #1863). */
export function parseHyperparameterEvolution(
  overrides: Record<string, unknown> | undefined,
): RequiredHyperparameterEvolutionConfig {
  const d = DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    minLearningRate: parseNumber(
      "Hyperparameter evolution minLearningRate",
      overrides?.minLearningRate,
      d.minLearningRate,
      { minExclusive: 0, max: 1 },
    ),
    maxLearningRate: parseNumber(
      "Hyperparameter evolution maxLearningRate",
      overrides?.maxLearningRate,
      d.maxLearningRate,
      { minExclusive: 0, max: 1 },
    ),
    minWeightPerturbation: parseNumber(
      "Hyperparameter evolution minWeightPerturbation",
      overrides?.minWeightPerturbation,
      d.minWeightPerturbation,
      { minExclusive: 0 },
    ),
    maxWeightPerturbation: parseNumber(
      "Hyperparameter evolution maxWeightPerturbation",
      overrides?.maxWeightPerturbation,
      d.maxWeightPerturbation,
      { minExclusive: 0 },
    ),
    maxRegularisationStrength: parseNumber(
      "Hyperparameter evolution maxRegularisationStrength",
      overrides?.maxRegularisationStrength,
      d.maxRegularisationStrength,
      { min: 0 },
    ),
    mutationStdDev: parseNumber(
      "Hyperparameter evolution mutationStdDev",
      overrides?.mutationStdDev,
      d.mutationStdDev,
      { minExclusive: 0, max: 1 },
    ),
  } as RequiredHyperparameterEvolutionConfig;
}

/** Parse cross-validation configuration (Issue #1865). */
export function parseCrossValidation(
  overrides: Record<string, unknown> | undefined,
): RequiredCrossValidationConfig {
  const d = DEFAULT_CROSS_VALIDATION_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    folds: parseNumber(
      "Cross-validation folds",
      overrides?.folds,
      d.folds,
      { integer: true, min: 1, max: 20 },
    ),
    validationEarlyStopping:
      typeof overrides?.validationEarlyStopping === "boolean"
        ? overrides.validationEarlyStopping
        : d.validationEarlyStopping,
  } as RequiredCrossValidationConfig;
}

/** Parse adaptive population sizing configuration (Issue #1863). */
export function parseAdaptivePopulation(
  overrides: Record<string, unknown> | undefined,
): RequiredAdaptivePopulationConfig {
  const d = DEFAULT_ADAPTIVE_POPULATION_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    minPopulationFraction: parseNumber(
      "Adaptive population minPopulationFraction",
      overrides?.minPopulationFraction,
      d.minPopulationFraction,
      { minExclusive: 0, max: 1 },
    ),
    maxPopulationFraction: parseNumber(
      "Adaptive population maxPopulationFraction",
      overrides?.maxPopulationFraction,
      d.maxPopulationFraction,
      { min: 1 },
    ),
    lowDiversityThreshold: parseNumber(
      "Adaptive population lowDiversityThreshold",
      overrides?.lowDiversityThreshold,
      d.lowDiversityThreshold,
      { min: 0, max: 1 },
    ),
    highDiversityThreshold: parseNumber(
      "Adaptive population highDiversityThreshold",
      overrides?.highDiversityThreshold,
      d.highDiversityThreshold,
      { min: 0, max: 1 },
    ),
    adjustmentRate: parseNumber(
      "Adaptive population adjustmentRate",
      overrides?.adjustmentRate,
      d.adjustmentRate,
      { minExclusive: 0, max: 1 },
    ),
  } as RequiredAdaptivePopulationConfig;
}

/** Parse parallel evaluation configuration (Issue #1862). */
export function parseParallelEvaluation(
  overrides: Record<string, unknown> | undefined,
): RequiredParallelEvaluationConfig {
  const d = DEFAULT_PARALLEL_EVALUATION_CONFIG;
  return {
    maxConcurrentEvaluations: parseNumber(
      "Parallel evaluation maxConcurrentEvaluations",
      overrides?.maxConcurrentEvaluations,
      d.maxConcurrentEvaluations,
      { integer: true, min: 0 },
    ),
    topologyGrouping: typeof overrides?.topologyGrouping === "boolean"
      ? overrides.topologyGrouping
      : d.topologyGrouping,
  } as RequiredParallelEvaluationConfig;
}

/** Parse data fuzzing configuration (Issue #1900). */
export function parseDataFuzzing(
  overrides: Record<string, unknown> | undefined,
): RequiredDataFuzzingConfig {
  const d = DEFAULT_DATA_FUZZING_CONFIG;
  const noiseTypeRaw = overrides?.noiseType;
  const noiseType: "gaussian" | "uniform" = noiseTypeRaw === "uniform"
    ? "uniform"
    : d.noiseType;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    inputNoiseScale: parseNumber(
      "Data fuzzing inputNoiseScale",
      overrides?.inputNoiseScale,
      d.inputNoiseScale,
      { min: 0, max: 1 },
    ),
    outputNoiseScale: parseNumber(
      "Data fuzzing outputNoiseScale",
      overrides?.outputNoiseScale,
      d.outputNoiseScale,
      { min: 0, max: 1 },
    ),
    noiseType,
  } as RequiredDataFuzzingConfig;
}

/** Parse MCMC acceptance configuration (Issue #2199). */
export function parseMcmc(
  overrides: Record<string, unknown> | undefined,
): RequiredMCMCConfig {
  const d = DEFAULT_MCMC_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    initialTemperature: parseNumber(
      "MCMC initialTemperature",
      overrides?.initialTemperature,
      d.initialTemperature,
      { minExclusive: 0 },
    ),
    minTemperature: parseNumber(
      "MCMC minTemperature",
      overrides?.minTemperature,
      d.minTemperature,
      { minExclusive: 0 },
    ),
    coolingRate: parseNumber(
      "MCMC coolingRate",
      overrides?.coolingRate,
      d.coolingRate,
      { minExclusive: 0, maxExclusive: 1 },
    ),
    targetAcceptanceRate: parseNumber(
      "MCMC targetAcceptanceRate",
      overrides?.targetAcceptanceRate,
      d.targetAcceptanceRate,
      { minExclusive: 0, maxExclusive: 1 },
    ),
  } as RequiredMCMCConfig;
}

/** Parse data quantisation configuration (Issue #1901). */
export function parseDataQuantisation(
  overrides: Record<string, unknown> | undefined,
): RequiredDataQuantisationConfig {
  const d = DEFAULT_DATA_QUANTISATION_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    inputLevels: parseNumber(
      "Data quantisation inputLevels",
      overrides?.inputLevels,
      d.inputLevels,
      { integer: true, min: 2, max: 65536 },
    ),
    outputLevels: (() => {
      const raw = parseNumber(
        "Data quantisation outputLevels",
        overrides?.outputLevels,
        d.outputLevels,
        { integer: true, min: 0, max: 65536 },
      );
      // outputLevels must be 0 (disabled) or >= 2
      if (raw > 0 && raw < 2) return 2;
      return raw;
    })(),
  } as RequiredDataQuantisationConfig;
}
