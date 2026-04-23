/**
 * Tests for RegularisationParsers (Issue #2396).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_BIAS_REGULARISATION_CONFIG } from "@config/BiasRegularisationConfig.ts";
import { DEFAULT_WEIGHT_REGULARISATION_CONFIG } from "@config/WeightRegularisationConfig.ts";
import {
  parseBiasRegularisation,
  parseWeightRegularisation,
} from "@config/parsers/RegularisationParsers.ts";

Deno.test("parseWeightRegularisation - returns defaults", () => {
  const cfg = parseWeightRegularisation(undefined);
  assertEquals(cfg.enabled, DEFAULT_WEIGHT_REGULARISATION_CONFIG.enabled);
  assertEquals(
    cfg.maxAbsoluteWeight,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.maxAbsoluteWeight,
  );
});

Deno.test("parseWeightRegularisation - applies overrides", () => {
  const cfg = parseWeightRegularisation({
    enabled: true,
    maxAbsoluteWeight: 5.0,
    maxWeightChange: 1.0,
    l2Strength: 0.001,
    preferSmallChanges: true,
    smallChangeScale: 0.5,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.maxAbsoluteWeight, 5.0);
  assertEquals(cfg.maxWeightChange, 1.0);
  assertEquals(cfg.l2Strength, 0.001);
  assertEquals(cfg.preferSmallChanges, true);
  assertEquals(cfg.smallChangeScale, 0.5);
});

Deno.test("parseWeightRegularisation - rejects maxAbsoluteWeight below 0.001", () => {
  assertThrows(
    () => parseWeightRegularisation({ maxAbsoluteWeight: 0 }),
    ConfigurationError,
  );
});

Deno.test("parseBiasRegularisation - returns defaults", () => {
  const cfg = parseBiasRegularisation(undefined);
  assertEquals(cfg.enabled, DEFAULT_BIAS_REGULARISATION_CONFIG.enabled);
  assertEquals(
    cfg.maxAbsoluteBias,
    DEFAULT_BIAS_REGULARISATION_CONFIG.maxAbsoluteBias,
  );
});

Deno.test("parseBiasRegularisation - applies overrides", () => {
  const cfg = parseBiasRegularisation({
    enabled: true,
    maxAbsoluteBias: 3.0,
    maxBiasChange: 0.5,
    l2Strength: 0.0001,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.maxAbsoluteBias, 3.0);
  assertEquals(cfg.maxBiasChange, 0.5);
  assertEquals(cfg.l2Strength, 0.0001);
});

Deno.test("parseBiasRegularisation - rejects l2Strength above 1", () => {
  assertThrows(
    () => parseBiasRegularisation({ l2Strength: 1.5 }),
    ConfigurationError,
  );
});
