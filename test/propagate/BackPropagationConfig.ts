/**
 * Unit tests for BackPropagation.ts config creation, learning rate
 * strategies, toValue/toActivation round-trips, and limitValue.
 *
 * Closes #1399
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLessOrEqual,
} from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
  type ErrorFeedback,
  limitValue,
} from "../../src/propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// createBackPropagationConfig
// ---------------------------------------------------------------------------

Deno.test("createBackPropagationConfig - returns frozen config", () => {
  const config = createBackPropagationConfig();
  assert(Object.isFrozen(config), "Config should be frozen");
});

Deno.test("createBackPropagationConfig - applies explicit overrides", () => {
  const config = createBackPropagationConfig({
    generations: 42,
    learningRate: 0.5,
    maximumBiasAdjustmentScale: 3,
    maximumWeightAdjustmentScale: 7,
    limitBiasScale: 500,
    limitWeightScale: 2000,
    plankConstant: 1e-9,
    batchSize: 32,
    sparseRatio: 0.8,
  });

  assertEquals(config.generations, 42);
  assertAlmostEquals(config.learningRate, 0.5, 1e-9);
  assertEquals(config.maximumBiasAdjustmentScale, 3);
  assertEquals(config.maximumWeightAdjustmentScale, 7);
  assertEquals(config.limitBiasScale, 500);
  assertEquals(config.limitWeightScale, 2000);
  assertAlmostEquals(config.plankConstant, 1e-9, 1e-15);
  assertEquals(config.batchSize, 32);
  assertAlmostEquals(config.sparseRatio, 0.8, 1e-9);
});

Deno.test("createBackPropagationConfig - clamps learningRate to [0.001, 1]", () => {
  const low = createBackPropagationConfig({ learningRate: -5 });
  assertGreater(low.learningRate, 0, "Learning rate should be positive");
  assertLessOrEqual(
    low.learningRate,
    1,
    "Learning rate should not exceed 1",
  );

  const high = createBackPropagationConfig({ learningRate: 50 });
  assertLessOrEqual(high.learningRate, 1);
});

Deno.test("createBackPropagationConfig - clamps generations to non-negative", () => {
  const config = createBackPropagationConfig({ generations: -10 });
  assertEquals(config.generations, 0);
});

Deno.test("createBackPropagationConfig - clamps limitBiasScale minimum to 1", () => {
  const config = createBackPropagationConfig({ limitBiasScale: 0 });
  assertEquals(config.limitBiasScale, 1);
});

Deno.test("createBackPropagationConfig - clamps limitWeightScale minimum to 1", () => {
  const config = createBackPropagationConfig({ limitWeightScale: -5 });
  assertEquals(config.limitWeightScale, 1);
});

Deno.test("createBackPropagationConfig - fixed strategy when learningRate is explicit", () => {
  const config = createBackPropagationConfig({ learningRate: 0.01 });
  assertEquals(config.learningRateStrategy, "fixed");
});

Deno.test("createBackPropagationConfig - disableRandomSamples defaults to false", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.disableRandomSamples, false);
});

Deno.test("createBackPropagationConfig - disableRandomSamples can be set true", () => {
  const config = createBackPropagationConfig({ disableRandomSamples: true });
  assertEquals(config.disableRandomSamples, true);
});

// ---------------------------------------------------------------------------
// calculateLearningRate - fixed
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate - fixed returns constant rate", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.05,
    learningRateStrategy: "fixed",
  });

  for (let i = 0; i < 10; i++) {
    assertAlmostEquals(calculateLearningRate(config, i), 0.05, 1e-9);
  }
});

// ---------------------------------------------------------------------------
// calculateLearningRate - decay
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate - decay decreases over iterations", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
  });

  const lr0 = calculateLearningRate(config, 0);
  const lr1 = calculateLearningRate(config, 1);
  const lr5 = calculateLearningRate(config, 5);

  assertAlmostEquals(lr0, 0.1, 1e-9, "iteration 0 = initialLearningRate");
  assertAlmostEquals(lr1, 0.1 * 0.9, 1e-9);
  assertAlmostEquals(lr5, 0.1 * Math.pow(0.9, 5), 1e-9);
  assertGreater(lr0, lr1, "Rate should decrease");
  assertGreater(lr1, lr5, "Rate should decrease further");
});

// ---------------------------------------------------------------------------
// calculateLearningRate - adaptive
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate - adaptive boosts when error improves", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const feedback: ErrorFeedback = {
    previousError: 1.0,
    currentError: 0.5, // error halved => good improvement
  };

  const lr = calculateLearningRate(config, 0, feedback);
  const base = config.initialLearningRate;

  // With 50% improvement ratio < 0.95, adjustment = 1.1
  assertAlmostEquals(lr, base * 1.1, 1e-9);
});

Deno.test("calculateLearningRate - adaptive increases on stagnation", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const feedback: ErrorFeedback = {
    previousError: 1.0,
    currentError: 0.97, // small improvement 0.95 <= ratio < 1.0
  };

  const lr = calculateLearningRate(config, 0, feedback);
  const base = config.initialLearningRate;

  // Stagnation => adjustment = 1.3
  assertAlmostEquals(lr, base * 1.3, 1e-9);
});

Deno.test("calculateLearningRate - adaptive reduces when error worsens", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const feedback: ErrorFeedback = {
    previousError: 1.0,
    currentError: 2.0, // error doubled
  };

  const lr = calculateLearningRate(config, 0, feedback);
  const base = config.initialLearningRate;

  // Worsened => adjustment = max(0.5, 1/2) = 0.5
  assertAlmostEquals(lr, base * 0.5, 1e-9);
});

Deno.test("calculateLearningRate - adaptive without feedback uses base decay", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // No feedback => errorAdjustment remains 1
  const lr = calculateLearningRate(config, 0);
  assertAlmostEquals(lr, 0.1, 1e-9, "Iteration 0 with no feedback");
});

Deno.test("calculateLearningRate - adaptive ignores non-finite feedback", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const feedback: ErrorFeedback = {
    previousError: NaN,
    currentError: 0.5,
  };

  const lr = calculateLearningRate(config, 0, feedback);
  assertAlmostEquals(lr, 0.1, 1e-9, "Non-finite feedback should be ignored");
});

Deno.test("calculateLearningRate - adaptive ignores zero previousError", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const feedback: ErrorFeedback = {
    previousError: 0,
    currentError: 0.5,
  };

  const lr = calculateLearningRate(config, 0, feedback);
  // previousError <= 0 should skip adjustment
  assertAlmostEquals(lr, 0.1, 1e-9);
});

// ---------------------------------------------------------------------------
// limitValue
// ---------------------------------------------------------------------------

Deno.test("limitValue - passes through normal values", () => {
  assertAlmostEquals(limitValue(0.5), 0.5, 1e-12);
  assertAlmostEquals(limitValue(-3.7), -3.7, 1e-12);
  assertAlmostEquals(limitValue(0), 0, 1e-12);
});

Deno.test("limitValue - clamps to 1e12", () => {
  assertAlmostEquals(limitValue(2e12), 1e12, 1e-6);
  assertAlmostEquals(limitValue(-2e12), -1e12, 1e-6);
});

Deno.test("limitValue - returns 0 for NaN", () => {
  assertEquals(limitValue(NaN), 0);
});

Deno.test("limitValue - clamps positive Infinity to 1e12", () => {
  assertEquals(limitValue(Infinity), 1e12);
});

Deno.test("limitValue - clamps negative Infinity to -1e12", () => {
  assertEquals(limitValue(-Infinity), -1e12);
});

Deno.test("limitValue - boundary: exactly 1e12 passes through", () => {
  assertAlmostEquals(limitValue(1e12), 1e12, 1e-6);
});
