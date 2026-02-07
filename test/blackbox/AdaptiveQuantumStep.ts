import { assertEquals, assertGreater, assertLessOrEqual } from "@std/assert";
import {
  calculateEffectiveStep,
  quantumAdjust,
} from "../../src/blackbox/FineTune.ts";
import { DEFAULT_QUANTUM_STEP_CONFIG } from "../../src/config/QuantumStepConfig.ts";

Deno.test("calculateEffectiveStep - returns minStep when error is zero", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const result = calculateEffectiveStep(0, config);
  assertEquals(result, config.minStep);
});

Deno.test("calculateEffectiveStep - returns minStep when errorScale is zero", () => {
  const config = { ...DEFAULT_QUANTUM_STEP_CONFIG, errorScale: 0 };
  const result = calculateEffectiveStep(0.5, config);
  assertEquals(result, config.minStep);
});

Deno.test("calculateEffectiveStep - larger error produces larger step", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const smallErrorStep = calculateEffectiveStep(0.01, config);
  const largeErrorStep = calculateEffectiveStep(0.5, config);
  assertGreater(largeErrorStep, smallErrorStep);
});

Deno.test("calculateEffectiveStep - never exceeds maxStep", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const result = calculateEffectiveStep(1_000_000, config);
  assertLessOrEqual(result, config.maxStep);
});

Deno.test("calculateEffectiveStep - never goes below minStep", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const result = calculateEffectiveStep(0.000_000_001, config);
  assertEquals(result >= config.minStep, true);
});

Deno.test("calculateEffectiveStep - custom config values respected", () => {
  const config = {
    minStep: 0.001,
    maxStep: 0.1,
    errorScale: 5,
  };
  const result = calculateEffectiveStep(0.5, config);
  assertEquals(result >= config.minStep, true);
  assertLessOrEqual(result, config.maxStep);
});

Deno.test("calculateEffectiveStep - negative error uses absolute value", () => {
  const config = DEFAULT_QUANTUM_STEP_CONFIG;
  const positiveResult = calculateEffectiveStep(0.5, config);
  const negativeResult = calculateEffectiveStep(-0.5, config);
  assertEquals(positiveResult, negativeResult);
});

Deno.test("calculateEffectiveStep - formula correctness", () => {
  const config = {
    minStep: 0.000_1,
    maxStep: 1.0,
    errorScale: 10,
  };
  // normalisedError = |0.1| / (1 + |0.1|) = 0.1/1.1 ≈ 0.0909
  // effectiveStep = 0.0001 * (1 + 10 * 0.0909) = 0.0001 * 1.909 ≈ 0.000_190_9
  const result = calculateEffectiveStep(0.1, config);
  const normalisedError = 0.1 / (1 + 0.1);
  const expected = config.minStep * (1 + config.errorScale * normalisedError);
  assertEquals(result, expected);
});

Deno.test("quantumAdjust - uses adaptive step with config", () => {
  const config = {
    minStep: 0.001,
    maxStep: 0.1,
    errorScale: 10,
  };
  // Large score difference should use larger effective step
  const result = quantumAdjust(1.0, 0.5, true, false, undefined, undefined, {
    quantumStepConfig: config,
    previousScore: -0.5,
    currentScore: -0.3,
  });
  assertEquals(result.changed, true);
});

Deno.test("quantumAdjust - backward compatible without adaptive config", () => {
  // Calling quantumAdjust without the adaptive config should still work
  const result = quantumAdjust(1.0, 0.5, true, false);
  assertEquals(result.changed, true);
});

Deno.test("calculateEffectiveStep - maxStep equals minStep yields minStep", () => {
  const config = {
    minStep: 0.001,
    maxStep: 0.001,
    errorScale: 10,
  };
  const result = calculateEffectiveStep(0.5, config);
  assertEquals(result, 0.001);
});
