import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";

Deno.test("PredictiveCodingConfig - defaults applied when not specified", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.predictiveCoding.enabled,
    DEFAULT_PREDICTIVE_CODING_CONFIG.enabled,
  );
  assertEquals(
    config.predictiveCoding.inferenceSteps,
    DEFAULT_PREDICTIVE_CODING_CONFIG.inferenceSteps,
  );
  assertEquals(
    config.predictiveCoding.inferenceRate,
    DEFAULT_PREDICTIVE_CODING_CONFIG.inferenceRate,
  );
  assertEquals(
    config.predictiveCoding.learningRate,
    DEFAULT_PREDICTIVE_CODING_CONFIG.learningRate,
  );
  assertEquals(
    config.predictiveCoding.energyThreshold,
    DEFAULT_PREDICTIVE_CODING_CONFIG.energyThreshold,
  );
});

Deno.test("PredictiveCodingConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    predictiveCoding: {
      enabled: true,
      inferenceSteps: 100,
      inferenceRate: 0.1,
      learningRate: 0.01,
      energyThreshold: 1e-4,
    },
  });
  assertEquals(config.predictiveCoding.enabled, true);
  assertEquals(config.predictiveCoding.inferenceSteps, 100);
  assertEquals(config.predictiveCoding.inferenceRate, 0.1);
  assertEquals(config.predictiveCoding.learningRate, 0.01);
  assertEquals(config.predictiveCoding.energyThreshold, 1e-4);
});

Deno.test("PredictiveCodingConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({
    predictiveCoding: {
      enabled: true,
    },
  });
  assertEquals(config.predictiveCoding.enabled, true);
  assertEquals(
    config.predictiveCoding.inferenceSteps,
    DEFAULT_PREDICTIVE_CODING_CONFIG.inferenceSteps,
  );
  assertEquals(
    config.predictiveCoding.inferenceRate,
    DEFAULT_PREDICTIVE_CODING_CONFIG.inferenceRate,
  );
  assertEquals(
    config.predictiveCoding.learningRate,
    DEFAULT_PREDICTIVE_CODING_CONFIG.learningRate,
  );
  assertEquals(
    config.predictiveCoding.energyThreshold,
    DEFAULT_PREDICTIVE_CODING_CONFIG.energyThreshold,
  );
});

Deno.test("PredictiveCodingConfig - string values coerced from CLI", () => {
  const config = createNeatConfig({
    predictiveCoding: {
      inferenceSteps: "100" as unknown as number,
      inferenceRate: "0.1" as unknown as number,
      learningRate: "0.01" as unknown as number,
      energyThreshold: "0.0001" as unknown as number,
    },
  });
  assertEquals(config.predictiveCoding.inferenceSteps, 100);
  assertEquals(config.predictiveCoding.inferenceRate, 0.1);
  assertEquals(config.predictiveCoding.learningRate, 0.01);
  assertEquals(config.predictiveCoding.energyThreshold, 0.0001);
});

Deno.test("PredictiveCodingConfig - inferenceSteps must be >= 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        predictiveCoding: { inferenceSteps: 0 },
      }),
    Error,
    "inferenceSteps",
  );
});

Deno.test("PredictiveCodingConfig - inferenceSteps must be integer", () => {
  assertThrows(
    () =>
      createNeatConfig({
        predictiveCoding: { inferenceSteps: 2.5 },
      }),
    Error,
    "inferenceSteps",
  );
});

Deno.test("PredictiveCodingConfig - inferenceRate must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        predictiveCoding: { inferenceRate: 0 },
      }),
    Error,
    "inferenceRate",
  );
});

Deno.test("PredictiveCodingConfig - negative inferenceRate rejected", () => {
  assertThrows(
    () =>
      createNeatConfig({
        predictiveCoding: { inferenceRate: -0.1 },
      }),
    Error,
    "inferenceRate",
  );
});

Deno.test("PredictiveCodingConfig - learningRate must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        predictiveCoding: { learningRate: 0 },
      }),
    Error,
    "learningRate",
  );
});

Deno.test("PredictiveCodingConfig - energyThreshold must be > 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        predictiveCoding: { energyThreshold: 0 },
      }),
    Error,
    "energyThreshold",
  );
});
