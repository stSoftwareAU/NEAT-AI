/**
 * Tests for MutationParsers (Issue #2396).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS } from "@config/AdaptiveMutationThresholds.ts";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";
import { DEFAULT_STABILITY_ADAPTATION_CONFIG } from "@config/StabilityAdaptationConfig.ts";
import { DEFAULT_PLATEAU_DETECTION } from "@neat/PlateauDetector.ts";
import {
  parseAdaptiveMutationThresholds,
  parseMcmc,
  parsePlateauDetection,
  parseStabilityAdaptation,
} from "@config/parsers/MutationParsers.ts";

Deno.test("parseAdaptiveMutationThresholds - returns defaults", () => {
  const cfg = parseAdaptiveMutationThresholds(undefined);
  assertEquals(cfg.medium, DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS.medium);
  assertEquals(cfg.large, DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS.large);
});

Deno.test("parseAdaptiveMutationThresholds - applies overrides", () => {
  const cfg = parseAdaptiveMutationThresholds({
    medium: 25,
    large: 100,
    largeTopologyWeight: 0.4,
  });
  assertEquals(cfg.medium, 25);
  assertEquals(cfg.large, 100);
  assertEquals(cfg.largeTopologyWeight, 0.4);
});

Deno.test("parseAdaptiveMutationThresholds - rejects largeTopologyWeight above 1", () => {
  assertThrows(
    () => parseAdaptiveMutationThresholds({ largeTopologyWeight: 1.5 }),
    ConfigurationError,
  );
});

Deno.test("parsePlateauDetection - returns defaults", () => {
  const cfg = parsePlateauDetection(undefined);
  assertEquals(cfg.windowSize, DEFAULT_PLATEAU_DETECTION.windowSize);
  assertEquals(cfg.enabled, DEFAULT_PLATEAU_DETECTION.enabled);
});

Deno.test("parsePlateauDetection - applies overrides", () => {
  const cfg = parsePlateauDetection({ enabled: true, windowSize: 50 });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.windowSize, 50);
});

Deno.test("parsePlateauDetection - rejects windowSize below 1", () => {
  assertThrows(
    () => parsePlateauDetection({ windowSize: 0 }),
    ConfigurationError,
  );
});

Deno.test("parseStabilityAdaptation - returns defaults", () => {
  const cfg = parseStabilityAdaptation(undefined);
  assertEquals(cfg.enabled, DEFAULT_STABILITY_ADAPTATION_CONFIG.enabled);
  assertEquals(
    cfg.brittlenessThreshold,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.brittlenessThreshold,
  );
});

Deno.test("parseStabilityAdaptation - applies overrides", () => {
  const cfg = parseStabilityAdaptation({
    enabled: true,
    brittlenessThreshold: 0.25,
    stableBoostFactor: 2.0,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.brittlenessThreshold, 0.25);
  assertEquals(cfg.stableBoostFactor, 2.0);
});

Deno.test("parseStabilityAdaptation - rejects stableBoostFactor below 1", () => {
  assertThrows(
    () => parseStabilityAdaptation({ stableBoostFactor: 0.5 }),
    ConfigurationError,
  );
});

Deno.test("parseMcmc - returns defaults", () => {
  const cfg = parseMcmc(undefined);
  assertEquals(cfg.enabled, DEFAULT_MCMC_CONFIG.enabled);
  assertEquals(
    cfg.initialTemperature,
    DEFAULT_MCMC_CONFIG.initialTemperature,
  );
});

Deno.test("parseMcmc - applies overrides", () => {
  const cfg = parseMcmc({
    enabled: true,
    initialTemperature: 2.5,
    coolingRate: 0.95,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.initialTemperature, 2.5);
  assertEquals(cfg.coolingRate, 0.95);
});

Deno.test("parseMcmc - rejects coolingRate of 1 (must be exclusive)", () => {
  assertThrows(
    () => parseMcmc({ coolingRate: 1 }),
    ConfigurationError,
  );
});
