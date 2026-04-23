/**
 * DataParsers.ts - Sub-config parsers for input/output data preprocessing.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for data
 * fuzzing (noise injection) and data quantisation (level binning).
 */

import {
  DEFAULT_DATA_FUZZING_CONFIG,
  type RequiredDataFuzzingConfig,
} from "@config/DataFuzzingConfig.ts";
import {
  DEFAULT_DATA_QUANTISATION_CONFIG,
  type RequiredDataQuantisationConfig,
} from "@config/DataQuantisationConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";

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
