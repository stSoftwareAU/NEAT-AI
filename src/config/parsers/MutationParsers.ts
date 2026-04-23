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
  DEFAULT_MCMC_CONFIG,
  type RequiredMCMCConfig,
} from "@config/MCMCConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";
import {
  DEFAULT_STABILITY_ADAPTATION_CONFIG,
  type RequiredStabilityAdaptationConfig,
} from "@config/StabilityAdaptationConfig.ts";
import {
  DEFAULT_PLATEAU_DETECTION,
  type RequiredPlateauDetectionConfig,
} from "@neat/PlateauDetector.ts";

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
  } as RequiredMCMCConfig;
}
