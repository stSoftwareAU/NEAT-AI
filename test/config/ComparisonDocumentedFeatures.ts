/**
 * Verifies that all features documented in COMPARISON.md are accessible
 * through the NeatConfig API. This ensures COMPARISON.md stays in sync
 * with the actual implementation.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test(
  "COMPARISON documented features - weight regularisation config is accessible",
  () => {
    const config = createNeatConfig({
      weightRegularisation: { enabled: true, l2Strength: 0.2 },
    });
    assertEquals(config.weightRegularisation.enabled, true);
    assertEquals(config.weightRegularisation.l2Strength, 0.2);
  },
);

Deno.test(
  "COMPARISON documented features - bias regularisation config is accessible",
  () => {
    const config = createNeatConfig({
      biasRegularisation: { enabled: true, l2Strength: 0.3 },
    });
    assertEquals(config.biasRegularisation.enabled, true);
    assertEquals(config.biasRegularisation.l2Strength, 0.3);
  },
);

Deno.test(
  "COMPARISON documented features - feedbackLoop enables recurrent mutations",
  () => {
    const feedforwardConfig = createNeatConfig({ feedbackLoop: false });
    assertEquals(feedforwardConfig.feedbackLoop, false);

    const recurrentConfig = createNeatConfig({
      feedbackLoop: true,
      disableRandomSamples: true,
    });
    assertEquals(recurrentConfig.feedbackLoop, true);
  },
);

Deno.test(
  "COMPARISON documented features - predictive coding config is accessible",
  () => {
    const config = createNeatConfig({
      predictiveCoding: {
        enabled: true,
        inferenceSteps: 30,
        learningRate: 0.002,
      },
    });
    assertEquals(config.predictiveCoding.enabled, true);
    assertEquals(config.predictiveCoding.inferenceSteps, 30);
    assertEquals(config.predictiveCoding.learningRate, 0.002);
  },
);

Deno.test(
  "COMPARISON documented features - adaptive mutation thresholds config is accessible",
  () => {
    const config = createNeatConfig({
      adaptiveMutationThresholds: { medium: 150, large: 400 },
    });
    assertEquals(config.adaptiveMutationThresholds.medium, 150);
    assertEquals(config.adaptiveMutationThresholds.large, 400);
  },
);

Deno.test(
  "COMPARISON documented features - plateau detection config is accessible",
  () => {
    const config = createNeatConfig({
      plateauDetection: { enabled: true, windowSize: 15 },
    });
    assertEquals(config.plateauDetection.enabled, true);
    assertEquals(config.plateauDetection.windowSize, 15);
  },
);

Deno.test(
  "COMPARISON documented features - stability adaptation config is accessible",
  () => {
    const config = createNeatConfig({
      stabilityAdaptation: { enabled: true, brittlenessThreshold: 0.4 },
    });
    assertEquals(config.stabilityAdaptation.enabled, true);
    assertEquals(config.stabilityAdaptation.brittlenessThreshold, 0.4);
  },
);

Deno.test(
  "COMPARISON documented features - quantum step config is accessible",
  () => {
    const config = createNeatConfig({
      quantumStep: { minStep: 0.0000001, maxStep: 0.01 },
    });
    assertEquals(config.quantumStep.minStep, 0.0000001);
    assertEquals(config.quantumStep.maxStep, 0.01);
  },
);

Deno.test(
  "COMPARISON documented features - all documented configs have defaults",
  () => {
    const config = createNeatConfig({});

    // All documented features should have default values
    assert(config.weightRegularisation !== undefined);
    assert(config.biasRegularisation !== undefined);
    assert(config.predictiveCoding !== undefined);
    assert(config.adaptiveMutationThresholds !== undefined);
    assert(config.plateauDetection !== undefined);
    assert(config.stabilityAdaptation !== undefined);
    assert(config.quantumStep !== undefined);

    // feedbackLoop defaults to false (forward-only)
    assertEquals(config.feedbackLoop, false);

    // Predictive coding defaults to disabled
    assertEquals(config.predictiveCoding.enabled, false);

    // Quantum step has sensible bounds
    assertNotEquals(config.quantumStep.minStep, 0);
    assert(config.quantumStep.maxStep >= config.quantumStep.minStep);
  },
);
