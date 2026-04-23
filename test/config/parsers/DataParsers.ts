/**
 * Tests for DataParsers (Issue #2396).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_DATA_FUZZING_CONFIG } from "@config/DataFuzzingConfig.ts";
import { DEFAULT_DATA_QUANTISATION_CONFIG } from "@config/DataQuantisationConfig.ts";
import {
  parseDataFuzzing,
  parseDataQuantisation,
} from "@config/parsers/DataParsers.ts";

Deno.test("parseDataFuzzing - returns defaults", () => {
  const cfg = parseDataFuzzing(undefined);
  assertEquals(cfg.enabled, DEFAULT_DATA_FUZZING_CONFIG.enabled);
  assertEquals(cfg.noiseType, DEFAULT_DATA_FUZZING_CONFIG.noiseType);
});

Deno.test("parseDataFuzzing - applies overrides including uniform noise", () => {
  const cfg = parseDataFuzzing({
    enabled: true,
    inputNoiseScale: 0.1,
    outputNoiseScale: 0.05,
    noiseType: "uniform",
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.inputNoiseScale, 0.1);
  assertEquals(cfg.outputNoiseScale, 0.05);
  assertEquals(cfg.noiseType, "uniform");
});

Deno.test("parseDataFuzzing - falls back to default noise type for unknown values", () => {
  const cfg = parseDataFuzzing({ noiseType: "weird" });
  assertEquals(cfg.noiseType, DEFAULT_DATA_FUZZING_CONFIG.noiseType);
});

Deno.test("parseDataFuzzing - rejects inputNoiseScale above 1", () => {
  assertThrows(
    () => parseDataFuzzing({ inputNoiseScale: 1.5 }),
    ConfigurationError,
  );
});

Deno.test("parseDataQuantisation - returns defaults", () => {
  const cfg = parseDataQuantisation(undefined);
  assertEquals(cfg.enabled, DEFAULT_DATA_QUANTISATION_CONFIG.enabled);
  assertEquals(cfg.inputLevels, DEFAULT_DATA_QUANTISATION_CONFIG.inputLevels);
  assertEquals(
    cfg.outputLevels,
    DEFAULT_DATA_QUANTISATION_CONFIG.outputLevels,
  );
});

Deno.test("parseDataQuantisation - applies overrides", () => {
  const cfg = parseDataQuantisation({
    enabled: true,
    inputLevels: 256,
    outputLevels: 16,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.inputLevels, 256);
  assertEquals(cfg.outputLevels, 16);
});

Deno.test("parseDataQuantisation - normalises outputLevels of 1 to 2", () => {
  const cfg = parseDataQuantisation({ outputLevels: 1 });
  assertEquals(cfg.outputLevels, 2);
});

Deno.test("parseDataQuantisation - allows outputLevels of 0 (disabled)", () => {
  const cfg = parseDataQuantisation({ outputLevels: 0 });
  assertEquals(cfg.outputLevels, 0);
});

Deno.test("parseDataQuantisation - rejects inputLevels below 2", () => {
  assertThrows(
    () => parseDataQuantisation({ inputLevels: 1 }),
    ConfigurationError,
  );
});
