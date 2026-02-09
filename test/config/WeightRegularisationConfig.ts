import { assertEquals } from "@std/assert";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
} from "../../src/config/WeightRegularisationConfig.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("WeightRegularisationConfig - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.weightRegularisation.enabled,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.enabled,
  );
  assertEquals(
    config.weightRegularisation.maxAbsoluteWeight,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.maxAbsoluteWeight,
  );
  assertEquals(
    config.weightRegularisation.maxWeightChange,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.maxWeightChange,
  );
  assertEquals(
    config.weightRegularisation.l2Strength,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.l2Strength,
  );
  assertEquals(
    config.weightRegularisation.preferSmallChanges,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.preferSmallChanges,
  );
  assertEquals(
    config.weightRegularisation.smallChangeScale,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.smallChangeScale,
  );
});

Deno.test("WeightRegularisationConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    weightRegularisation: {
      enabled: false,
      maxAbsoluteWeight: 50,
      maxWeightChange: 5,
      l2Strength: 0.5,
    },
  });
  assertEquals(config.weightRegularisation.enabled, false);
  assertEquals(config.weightRegularisation.maxAbsoluteWeight, 50);
  assertEquals(config.weightRegularisation.maxWeightChange, 5);
  assertEquals(config.weightRegularisation.l2Strength, 0.5);
  // Non-overridden fields keep defaults
  assertEquals(
    config.weightRegularisation.preferSmallChanges,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.preferSmallChanges,
  );
});

Deno.test("WeightRegularisationConfig - boolean fields accept boolean values", () => {
  const config = createNeatConfig({
    weightRegularisation: {
      enabled: false,
      preferSmallChanges: false,
    },
  });
  assertEquals(config.weightRegularisation.enabled, false);
  assertEquals(config.weightRegularisation.preferSmallChanges, false);
});

Deno.test("WeightRegularisationConfig - string values are parsed from CLI", () => {
  const config = createNeatConfig({
    weightRegularisation: {
      maxAbsoluteWeight: "200" as unknown as number,
      maxWeightChange: "20" as unknown as number,
      l2Strength: "0.05" as unknown as number,
      smallChangeScale: "0.8" as unknown as number,
    },
  });
  assertEquals(config.weightRegularisation.maxAbsoluteWeight, 200);
  assertEquals(config.weightRegularisation.maxWeightChange, 20);
  assertEquals(config.weightRegularisation.l2Strength, 0.05);
  assertEquals(config.weightRegularisation.smallChangeScale, 0.8);
});

Deno.test("WeightRegularisationConfig - partial overrides keep other defaults", () => {
  const config = createNeatConfig({
    weightRegularisation: {
      l2Strength: 0.3,
    },
  });
  assertEquals(config.weightRegularisation.l2Strength, 0.3);
  assertEquals(
    config.weightRegularisation.enabled,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.enabled,
  );
  assertEquals(
    config.weightRegularisation.maxAbsoluteWeight,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG.maxAbsoluteWeight,
  );
});
