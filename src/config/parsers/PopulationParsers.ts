/**
 * PopulationParsers.ts - Sub-config parsers for population control.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for
 * fine-tune population sizing, adaptive population sizing, and ensemble
 * diversity selection pressure.
 */

import {
  DEFAULT_ADAPTIVE_POPULATION_CONFIG,
  type RequiredAdaptivePopulationConfig,
} from "@config/AdaptivePopulationConfig.ts";
import {
  DEFAULT_COMPATIBILITY_GATING_CONFIG,
  type RequiredCompatibilityGatingConfig,
} from "@config/CompatibilityGatingConfig.ts";
import {
  DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
  type RequiredEnsembleDiversityConfig,
} from "@config/EnsembleDiversityConfig.ts";
import {
  DEFAULT_FINE_TUNE_POPULATION_CONFIG,
  type RequiredFineTunePopulationConfig,
} from "@config/FineTunePopulationConfig.ts";
import {
  DEFAULT_FITNESS_SHARING_CONFIG,
  type RequiredFitnessSharingConfig,
} from "@config/FitnessSharingConfig.ts";
import {
  DEFAULT_NOVELTY_CONFIG,
  type RequiredNoveltyConfig,
} from "@config/NoveltyConfig.ts";
import {
  DEFAULT_SPECIES_STAGNATION_CONFIG,
  type RequiredSpeciesStagnationConfig,
} from "@config/SpeciesStagnationConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";

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
    minCreaturesPerWorker: parseNumber(
      "Adaptive population minCreaturesPerWorker",
      overrides?.minCreaturesPerWorker,
      d.minCreaturesPerWorker,
      { integer: true, min: 0 },
    ),
  } as RequiredAdaptivePopulationConfig;
}

/** Parse fitness sharing configuration (Issue #2453). */
export function parseFitnessSharing(
  overrides: Record<string, unknown> | undefined,
): RequiredFitnessSharingConfig {
  const d = DEFAULT_FITNESS_SHARING_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    minSpeciesSlots: parseNumber(
      "Fitness sharing minSpeciesSlots",
      overrides?.minSpeciesSlots,
      d.minSpeciesSlots,
      { integer: true, min: 0 },
    ),
  } as RequiredFitnessSharingConfig;
}

/** Parse novelty (behavioural-diversity) configuration (Issue #2932). */
export function parseNovelty(
  overrides: Record<string, unknown> | undefined,
): RequiredNoveltyConfig {
  const d = DEFAULT_NOVELTY_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    weight: parseNumber(
      "Novelty weight",
      overrides?.weight,
      d.weight,
      { min: 0, max: 1 },
    ),
    neighbours: parseNumber(
      "Novelty neighbours",
      overrides?.neighbours,
      d.neighbours,
      { integer: true, min: 1 },
    ),
    archiveLimit: parseNumber(
      "Novelty archiveLimit",
      overrides?.archiveLimit,
      d.archiveLimit,
      { integer: true, min: 1 },
    ),
    addThreshold: parseNumber(
      "Novelty addThreshold",
      overrides?.addThreshold,
      d.addThreshold,
      { min: 0 },
    ),
    behaviourTag: typeof overrides?.behaviourTag === "string" &&
        overrides.behaviourTag.length > 0
      ? overrides.behaviourTag
      : d.behaviourTag,
  } as RequiredNoveltyConfig;
}

/** Parse compatibility gating configuration (Issue #2455). */
export function parseCompatibilityGating(
  overrides: Record<string, unknown> | undefined,
): RequiredCompatibilityGatingConfig {
  const d = DEFAULT_COMPATIBILITY_GATING_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    power: parseNumber(
      "Compatibility gating power",
      overrides?.power,
      d.power,
      { min: 0 },
    ),
    maxDraws: parseNumber(
      "Compatibility gating maxDraws",
      overrides?.maxDraws,
      d.maxDraws,
      { integer: true, min: 1 },
    ),
  } as RequiredCompatibilityGatingConfig;
}

/** Parse species stagnation configuration (Issue #2454). */
export function parseSpeciesStagnation(
  overrides: Record<string, unknown> | undefined,
): RequiredSpeciesStagnationConfig {
  const d = DEFAULT_SPECIES_STAGNATION_CONFIG;
  return {
    enabled: typeof overrides?.enabled === "boolean"
      ? overrides.enabled
      : d.enabled,
    haltWindow: parseNumber(
      "Species stagnation haltWindow",
      overrides?.haltWindow,
      d.haltWindow,
      { integer: true, min: 1 },
    ),
    extinctionWindow: parseNumber(
      "Species stagnation extinctionWindow",
      overrides?.extinctionWindow,
      d.extinctionWindow,
      { integer: true, min: 1 },
    ),
  } as RequiredSpeciesStagnationConfig;
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
