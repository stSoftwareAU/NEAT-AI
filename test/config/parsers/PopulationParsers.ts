/**
 * Tests for PopulationParsers (Issue #2396).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_ADAPTIVE_POPULATION_CONFIG } from "@config/AdaptivePopulationConfig.ts";
import { DEFAULT_FINE_TUNE_POPULATION_CONFIG } from "@config/FineTunePopulationConfig.ts";
import {
  parseAdaptivePopulation,
  parseFineTunePopulation,
} from "@config/parsers/PopulationParsers.ts";

Deno.test("parseFineTunePopulation - returns defaults", () => {
  const cfg = parseFineTunePopulation(undefined);
  assertEquals(
    cfg.minPopulationFraction,
    DEFAULT_FINE_TUNE_POPULATION_CONFIG.minPopulationFraction,
  );
  assertEquals(
    cfg.successRateWindow,
    DEFAULT_FINE_TUNE_POPULATION_CONFIG.successRateWindow,
  );
});

Deno.test("parseFineTunePopulation - applies overrides", () => {
  const cfg = parseFineTunePopulation({
    minPopulationFraction: 0.1,
    maxPopulationFraction: 0.4,
    basePopulationFraction: 0.25,
    successRateWindow: 5,
  });
  assertEquals(cfg.minPopulationFraction, 0.1);
  assertEquals(cfg.maxPopulationFraction, 0.4);
  assertEquals(cfg.basePopulationFraction, 0.25);
  assertEquals(cfg.successRateWindow, 5);
});

Deno.test("parseFineTunePopulation - rejects successRateWindow below 1", () => {
  assertThrows(
    () => parseFineTunePopulation({ successRateWindow: 0 }),
    ConfigurationError,
  );
});

Deno.test("parseAdaptivePopulation - returns defaults", () => {
  const cfg = parseAdaptivePopulation(undefined);
  assertEquals(cfg.enabled, DEFAULT_ADAPTIVE_POPULATION_CONFIG.enabled);
  assertEquals(
    cfg.maxPopulationFraction,
    DEFAULT_ADAPTIVE_POPULATION_CONFIG.maxPopulationFraction,
  );
});

Deno.test("parseAdaptivePopulation - applies overrides", () => {
  const cfg = parseAdaptivePopulation({
    enabled: true,
    minPopulationFraction: 0.5,
    maxPopulationFraction: 1.5,
    minCreaturesPerWorker: 4,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.minPopulationFraction, 0.5);
  assertEquals(cfg.maxPopulationFraction, 1.5);
  assertEquals(cfg.minCreaturesPerWorker, 4);
});

Deno.test("parseAdaptivePopulation - rejects maxPopulationFraction below 1", () => {
  assertThrows(
    () => parseAdaptivePopulation({ maxPopulationFraction: 0.5 }),
    ConfigurationError,
  );
});

Deno.test("parseAdaptivePopulation - rejects minPopulationFraction of 0 (exclusive)", () => {
  assertThrows(
    () => parseAdaptivePopulation({ minPopulationFraction: 0 }),
    ConfigurationError,
  );
});
