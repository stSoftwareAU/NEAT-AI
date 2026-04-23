/**
 * RegularisationParsers.ts - Sub-config parsers for regularisation.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for weight
 * and bias regularisation limits applied during backpropagation.
 */

import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
  type RequiredBiasRegularisationConfig,
} from "@config/BiasRegularisationConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  type RequiredWeightRegularisationConfig,
} from "@config/WeightRegularisationConfig.ts";

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
