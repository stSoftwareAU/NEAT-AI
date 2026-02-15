import { assertEquals } from "@std/assert";
import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
} from "../../src/config/BiasRegularisationConfig.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("BiasRegularisationConfig - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.biasRegularisation.enabled,
    DEFAULT_BIAS_REGULARISATION_CONFIG.enabled,
  );
  assertEquals(
    config.biasRegularisation.maxAbsoluteBias,
    DEFAULT_BIAS_REGULARISATION_CONFIG.maxAbsoluteBias,
  );
  assertEquals(
    config.biasRegularisation.maxBiasChange,
    DEFAULT_BIAS_REGULARISATION_CONFIG.maxBiasChange,
  );
  assertEquals(
    config.biasRegularisation.l2Strength,
    DEFAULT_BIAS_REGULARISATION_CONFIG.l2Strength,
  );
  assertEquals(
    config.biasRegularisation.preferSmallChanges,
    DEFAULT_BIAS_REGULARISATION_CONFIG.preferSmallChanges,
  );
  assertEquals(
    config.biasRegularisation.smallChangeScale,
    DEFAULT_BIAS_REGULARISATION_CONFIG.smallChangeScale,
  );
});

Deno.test("BiasRegularisationConfig - default values are sensible", () => {
  assertEquals(DEFAULT_BIAS_REGULARISATION_CONFIG.enabled, true);
  assertEquals(DEFAULT_BIAS_REGULARISATION_CONFIG.maxAbsoluteBias, 100);
  assertEquals(DEFAULT_BIAS_REGULARISATION_CONFIG.maxBiasChange, 10);
  assertEquals(DEFAULT_BIAS_REGULARISATION_CONFIG.l2Strength, 0.1);
  assertEquals(DEFAULT_BIAS_REGULARISATION_CONFIG.preferSmallChanges, true);
  assertEquals(DEFAULT_BIAS_REGULARISATION_CONFIG.smallChangeScale, 0.5);
});

Deno.test("BiasRegularisationConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    biasRegularisation: {
      enabled: false,
      maxAbsoluteBias: 50,
      maxBiasChange: 5,
      l2Strength: 0.5,
    },
  });
  assertEquals(config.biasRegularisation.enabled, false);
  assertEquals(config.biasRegularisation.maxAbsoluteBias, 50);
  assertEquals(config.biasRegularisation.maxBiasChange, 5);
  assertEquals(config.biasRegularisation.l2Strength, 0.5);
  // Non-overridden fields keep defaults
  assertEquals(
    config.biasRegularisation.preferSmallChanges,
    DEFAULT_BIAS_REGULARISATION_CONFIG.preferSmallChanges,
  );
});

Deno.test("BiasRegularisationConfig - partial overrides keep other defaults", () => {
  const config = createNeatConfig({
    biasRegularisation: {
      l2Strength: 0.3,
    },
  });
  assertEquals(config.biasRegularisation.l2Strength, 0.3);
  assertEquals(
    config.biasRegularisation.enabled,
    DEFAULT_BIAS_REGULARISATION_CONFIG.enabled,
  );
  assertEquals(
    config.biasRegularisation.maxAbsoluteBias,
    DEFAULT_BIAS_REGULARISATION_CONFIG.maxAbsoluteBias,
  );
  assertEquals(
    config.biasRegularisation.maxBiasChange,
    DEFAULT_BIAS_REGULARISATION_CONFIG.maxBiasChange,
  );
});

Deno.test("BiasRegularisationConfig - boolean fields accept boolean values", () => {
  const config = createNeatConfig({
    biasRegularisation: {
      enabled: false,
      preferSmallChanges: false,
    },
  });
  assertEquals(config.biasRegularisation.enabled, false);
  assertEquals(config.biasRegularisation.preferSmallChanges, false);
});

Deno.test("BiasRegularisationConfig - string values are parsed from CLI", () => {
  const config = createNeatConfig({
    biasRegularisation: {
      maxAbsoluteBias: "200" as unknown as number,
      maxBiasChange: "20" as unknown as number,
      l2Strength: "0.05" as unknown as number,
      smallChangeScale: "0.8" as unknown as number,
    },
  });
  assertEquals(config.biasRegularisation.maxAbsoluteBias, 200);
  assertEquals(config.biasRegularisation.maxBiasChange, 20);
  assertEquals(config.biasRegularisation.l2Strength, 0.05);
  assertEquals(config.biasRegularisation.smallChangeScale, 0.8);
});

Deno.test("BiasRegularisationConfig - Required type fills all fields", () => {
  const config = createNeatConfig({});
  const bias = config.biasRegularisation;
  // All fields should be defined (not undefined) in the Required type
  assertEquals(typeof bias.enabled, "boolean");
  assertEquals(typeof bias.maxAbsoluteBias, "number");
  assertEquals(typeof bias.maxBiasChange, "number");
  assertEquals(typeof bias.l2Strength, "number");
  assertEquals(typeof bias.preferSmallChanges, "boolean");
  assertEquals(typeof bias.smallChangeScale, "number");
});

Deno.test("BiasRegularisationConfig - zero l2Strength disables regularisation penalty", () => {
  const config = createNeatConfig({
    biasRegularisation: {
      l2Strength: 0,
    },
  });
  assertEquals(config.biasRegularisation.l2Strength, 0);
});
