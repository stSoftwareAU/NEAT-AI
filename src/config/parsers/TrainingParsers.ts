/**
 * TrainingParsers.ts - Sub-config parsers for training and learning.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for
 * quantum step sizing and predictive coding inference.
 */

import { parseNumber } from "@config/ParseOptions.ts";
import {
  DEFAULT_PREDICTIVE_CODING_CONFIG,
  type RequiredPredictiveCodingConfig,
} from "@config/PredictiveCodingConfig.ts";
import {
  DEFAULT_QUANTUM_STEP_CONFIG,
  type RequiredQuantumStepConfig,
} from "@config/QuantumStepConfig.ts";

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
