import { assertEquals } from "@std/assert";
import {
  DEFAULT_STABILITY_ADAPTATION_CONFIG,
} from "../../src/config/StabilityAdaptationConfig.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("StabilityAdaptationConfig - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.stabilityAdaptation.enabled,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.enabled,
  );
  assertEquals(
    config.stabilityAdaptation.stabilityWindowSize,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.stabilityWindowSize,
  );
  assertEquals(
    config.stabilityAdaptation.brittlenessThreshold,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.brittlenessThreshold,
  );
  assertEquals(
    config.stabilityAdaptation.brittleReductionFactor,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.brittleReductionFactor,
  );
  assertEquals(
    config.stabilityAdaptation.stableBoostFactor,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.stableBoostFactor,
  );
  assertEquals(
    config.stabilityAdaptation.stableBoostThreshold,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.stableBoostThreshold,
  );
  assertEquals(
    config.stabilityAdaptation.selectionStabilityWeight,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.selectionStabilityWeight,
  );
  assertEquals(
    config.stabilityAdaptation.adaptiveSelectionWeight,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.adaptiveSelectionWeight,
  );
  assertEquals(
    config.stabilityAdaptation.topologyMutationReductionForBrittle,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.topologyMutationReductionForBrittle,
  );
  assertEquals(
    config.stabilityAdaptation.trackPerMutationType,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.trackPerMutationType,
  );
});

Deno.test("StabilityAdaptationConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    stabilityAdaptation: {
      enabled: true,
      stabilityWindowSize: 50,
      brittlenessThreshold: 0.5,
      stableBoostFactor: 1.5,
    },
  });
  assertEquals(config.stabilityAdaptation.enabled, true);
  assertEquals(config.stabilityAdaptation.stabilityWindowSize, 50);
  assertEquals(config.stabilityAdaptation.brittlenessThreshold, 0.5);
  assertEquals(config.stabilityAdaptation.stableBoostFactor, 1.5);
  // Non-overridden fields keep defaults
  assertEquals(
    config.stabilityAdaptation.brittleReductionFactor,
    DEFAULT_STABILITY_ADAPTATION_CONFIG.brittleReductionFactor,
  );
});

Deno.test("StabilityAdaptationConfig - boolean fields accept boolean values", () => {
  const config = createNeatConfig({
    stabilityAdaptation: {
      enabled: true,
      adaptiveSelectionWeight: true,
      trackPerMutationType: true,
    },
  });
  assertEquals(config.stabilityAdaptation.enabled, true);
  assertEquals(config.stabilityAdaptation.adaptiveSelectionWeight, true);
  assertEquals(config.stabilityAdaptation.trackPerMutationType, true);
});

Deno.test("StabilityAdaptationConfig - string values are parsed from CLI", () => {
  const config = createNeatConfig({
    stabilityAdaptation: {
      stabilityWindowSize: "30" as unknown as number,
      brittlenessThreshold: "0.4" as unknown as number,
      stableBoostFactor: "2.0" as unknown as number,
    },
  });
  assertEquals(config.stabilityAdaptation.stabilityWindowSize, 30);
  assertEquals(config.stabilityAdaptation.brittlenessThreshold, 0.4);
  assertEquals(config.stabilityAdaptation.stableBoostFactor, 2.0);
});
