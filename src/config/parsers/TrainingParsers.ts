/**
 * TrainingParsers.ts - Sub-config parsers for training and learning.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for
 * hyperparameter evolution, quantum step sizing, predictive coding
 * inference, and cross-validation folds.
 */

import {
  DEFAULT_CROSS_VALIDATION_CONFIG,
  type RequiredCrossValidationConfig,
} from "@config/CrossValidationConfig.ts";
import {
  DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
  type RequiredHyperparameterEvolutionConfig,
} from "@config/HyperparameterConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";
import {
  DEFAULT_PREDICTIVE_CODING_CONFIG,
  type RequiredPredictiveCodingConfig,
} from "@config/PredictiveCodingConfig.ts";
import {
  DEFAULT_QUANTUM_STEP_CONFIG,
  type RequiredQuantumStepConfig,
} from "@config/QuantumStepConfig.ts";

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
