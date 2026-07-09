/**
 * MutationParsers.ts - Sub-config parsers for mutation control.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for adaptive
 * mutation thresholds, plateau detection, stability adaptation, and
 * MCMC mutation acceptance.
 */

import {
  DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS,
  type RequiredAdaptiveMutationThresholds,
} from "@config/AdaptiveMutationThresholds.ts";
import {
  DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG,
  DEFAULT_MCMC_CONFIG,
  type RequiredDiversityAwareMCMCConfig,
  type RequiredMCMCConfig,
} from "@config/MCMCConfig.ts";
import {
  DEFAULT_OPD_CONFIG,
  type RequiredOpdConfig,
} from "@config/OpdConfig.ts";
import {
  DEFAULT_SPECIALIST_CONFIG,
  type RequiredSpecialistConfig,
  type SpecialistMode,
} from "@config/SpecialistConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";
import {
  DEFAULT_STABILITY_ADAPTATION_CONFIG,
  type RequiredStabilityAdaptationConfig,
} from "@config/StabilityAdaptationConfig.ts";
import {
  DEFAULT_PLATEAU_DETECTION,
  type RequiredPlateauDetectionConfig,
} from "@neat/PlateauDetector.ts";
import {
  DEFAULT_SQUASH_EFFECTIVENESS_CONFIG,
  type RequiredSquashEffectivenessConfig,
} from "@config/SquashEffectivenessConfig.ts";
import {
  DEFAULT_SQUASH_BUDGET_CONFIG,
  type RequiredSquashBudgetConfig,
} from "@config/SquashBudgetConfig.ts";
import { ValidationError } from "@errors/ValidationError.ts";

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
    adjustmentRate: parseNumber(
      "MCMC adjustmentRate",
      overrides?.adjustmentRate,
      d.adjustmentRate,
      { minExclusive: 0, maxExclusive: 1 },
    ),
    toleranceRate: parseNumber(
      "MCMC toleranceRate",
      overrides?.toleranceRate,
      d.toleranceRate,
      { minExclusive: 0, maxExclusive: 1 },
    ),
    diversityAwareMCMC: parseDiversityAwareMCMC(
      overrides?.diversityAwareMCMC as Record<string, unknown> | undefined,
    ),
    // Issue #2527: GRPO-style group-relative advantage signal.
    mcmcAdvantageMode: parseAdvantageMode(
      overrides?.mcmcAdvantageMode,
      d.mcmcAdvantageMode,
    ),
    minCohortSize: parseNumber(
      "MCMC minCohortSize",
      overrides?.minCohortSize,
      d.minCohortSize,
      { integer: true, min: 1 },
    ),
    advantageEps: parseNumber(
      "MCMC advantageEps",
      overrides?.advantageEps,
      d.advantageEps,
      { minExclusive: 0 },
    ),
    advantageClip: parseNumber(
      "MCMC advantageClip",
      overrides?.advantageClip,
      d.advantageClip,
      { minExclusive: 0 },
    ),
  } as RequiredMCMCConfig;
}

/**
 * Parses the `mcmcAdvantageMode` option (Issue #2527). Accepts only the
 * two documented string literals so an out-of-spectrum CLI value fails
 * fast instead of silently degrading to the default.
 */
function parseAdvantageMode(
  raw: unknown,
  fallback: "absolute" | "groupRelative",
): "absolute" | "groupRelative" {
  if (raw === undefined || raw === null) return fallback;
  if (raw === "absolute" || raw === "groupRelative") return raw;
  throw new Error(
    `MCMC mcmcAdvantageMode must be "absolute" or "groupRelative", got ${
      JSON.stringify(raw)
    }`,
  );
}

/** Parse diversity-aware MCMC reheat configuration (Issue #2456). */
export function parseDiversityAwareMCMC(
  overrides: Record<string, unknown> | undefined,
): RequiredDiversityAwareMCMCConfig {
  const d = DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    minSpecies: parseNumber(
      "Diversity-aware MCMC minSpecies",
      overrides?.minSpecies,
      d.minSpecies,
      { integer: true, min: 0 },
    ),
    crowdingThreshold: parseNumber(
      "Diversity-aware MCMC crowdingThreshold",
      overrides?.crowdingThreshold,
      d.crowdingThreshold,
      { min: 0 },
    ),
    reheatFactor: parseNumber(
      "Diversity-aware MCMC reheatFactor",
      overrides?.reheatFactor,
      d.reheatFactor,
      { minExclusive: 1 },
    ),
  };
}

/**
 * Parse On-Policy Distillation breeding configuration (Issue #2528).
 *
 * Validates ranges so an out-of-range CLI value (e.g. negative breed
 * rate, zero distillation steps) fails fast instead of silently
 * disabling the operator at runtime.
 */
export function parseOpd(
  overrides: Record<string, unknown> | undefined,
): RequiredOpdConfig {
  const d = DEFAULT_OPD_CONFIG;
  return {
    breedRate: parseNumber(
      "OPD breedRate",
      overrides?.breedRate,
      d.breedRate,
      { min: 0, max: 1 },
    ),
    teacherCount: parseNumber(
      "OPD teacherCount",
      overrides?.teacherCount,
      d.teacherCount,
      { integer: true, min: 1 },
    ),
    distillationSteps: parseNumber(
      "OPD distillationSteps",
      overrides?.distillationSteps,
      d.distillationSteps,
      { integer: true, min: 1 },
    ),
    calibrationBatchSize: parseNumber(
      "OPD calibrationBatchSize",
      overrides?.calibrationBatchSize,
      d.calibrationBatchSize,
      { integer: true, min: 1 },
    ),
    temperature: parseNumber(
      "OPD temperature",
      overrides?.temperature,
      d.temperature,
      { minExclusive: 0 },
    ),
    learningRate: parseNumber(
      "OPD learningRate",
      overrides?.learningRate,
      d.learningRate,
      { minExclusive: 0, max: 1 },
    ),
  };
}

/**
 * Parse specialist sub-population pipeline configuration (Issue #2530).
 *
 * Validates the mode enum and numeric ranges so an out-of-range CLI
 * value (e.g. zero distillation cadence) fails fast at config build
 * time instead of silently misbehaving at runtime.
 */
export function parseSpecialist(
  overrides: Record<string, unknown> | undefined,
): RequiredSpecialistConfig {
  const d = DEFAULT_SPECIALIST_CONFIG;
  const rawMode = overrides?.mode;
  const mode: SpecialistMode = rawMode === "auto" || rawMode === "manual" ||
      rawMode === "off"
    ? rawMode
    : d.mode;

  const rawIds = overrides?.subTaskIds;
  const subTaskIds: readonly string[] = Array.isArray(rawIds)
    ? rawIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : d.subTaskIds;

  return {
    mode,
    distillEveryN: parseNumber(
      "Specialist distillEveryN",
      overrides?.distillEveryN,
      d.distillEveryN,
      { integer: true, min: 1 },
    ),
    subTaskIds,
    minSpecialistsPerTask: parseNumber(
      "Specialist minSpecialistsPerTask",
      overrides?.minSpecialistsPerTask,
      d.minSpecialistsPerTask,
      { integer: true, min: 1 },
    ),
  };
}

/** Parse squash effectiveness tracker configuration (Issue #2457). */
export function parseSquashEffectiveness(
  overrides: Record<string, unknown> | undefined,
): RequiredSquashEffectivenessConfig {
  const d = DEFAULT_SQUASH_EFFECTIVENESS_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    minSamples: parseNumber(
      "Squash effectiveness minSamples",
      overrides?.minSamples,
      d.minSamples,
      { integer: true, min: 1 },
    ),
    explorationWeight: parseNumber(
      "Squash effectiveness explorationWeight",
      overrides?.explorationWeight,
      d.explorationWeight,
      { min: 0, max: 1 },
    ),
    emaAlpha: parseNumber(
      "Squash effectiveness emaAlpha",
      overrides?.emaAlpha,
      d.emaAlpha,
      { minExclusive: 0, max: 1 },
    ),
    boltzmannBeta: parseNumber(
      "Squash effectiveness boltzmannBeta",
      overrides?.boltzmannBeta,
      d.boltzmannBeta,
      { min: 0 },
    ),
    fanInLowThreshold: parseNumber(
      "Squash effectiveness fanInLowThreshold",
      overrides?.fanInLowThreshold,
      d.fanInLowThreshold,
      { integer: true, min: 1 },
    ),
    fanInHighThreshold: parseNumber(
      "Squash effectiveness fanInHighThreshold",
      overrides?.fanInHighThreshold,
      d.fanInHighThreshold,
      { integer: true, min: 2 },
    ),
  } as RequiredSquashEffectivenessConfig;
}

/**
 * Parse the opt-in squash budget configuration (Issue #3263).
 *
 * Validates the structural shape of `allowedSquashes` (an array of non-empty
 * strings) and de-duplicates it. Activation-name resolution — rejecting
 * unknown squashes — happens when the budget is applied via
 * `Activations.setAllowedSquashes`, so this parser stays decoupled from the
 * activation registry.
 */
export function parseSquashBudget(
  overrides: Record<string, unknown> | undefined,
): RequiredSquashBudgetConfig {
  const d = DEFAULT_SQUASH_BUDGET_CONFIG;
  const raw = overrides?.allowedSquashes;
  if (raw === undefined || raw === null) {
    return { allowedSquashes: [...d.allowedSquashes] };
  }
  if (!Array.isArray(raw)) {
    throw new ValidationError(
      "Squash budget allowedSquashes must be an array of activation names",
      "OTHER",
    );
  }

  const seen = new Set<string>();
  const allowedSquashes: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new ValidationError(
        "Squash budget allowedSquashes entries must be non-empty strings",
        "OTHER",
      );
    }
    const name = entry.trim();
    if (!seen.has(name)) {
      seen.add(name);
      allowedSquashes.push(name);
    }
  }

  return { allowedSquashes };
}
