/**
 * Consolidated tests for BackPropagation — verifying configuration
 * creation, clamping, defaults, learning rate strategies, and limitValue.
 *
 * Merged from BackPropagation.ts, BackPropagationConfig.ts,
 * BackPropagationConfigBehaviour.ts as part of Issue #1766
 * (propagation module test audit).
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertGreaterOrEqual,
  assertLessOrEqual,
} from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
  type ErrorFeedback,
  limitValue,
} from "@propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// createBackPropagationConfig - frozen and defaults
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - config is frozen", () => {
  const config = createBackPropagationConfig({ disableRandomSamples: true });
  assert(Object.isFrozen(config), "Config must be frozen");
});

Deno.test("BackPropConfig - default batchSize is 64", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.batchSize, 64);
});

Deno.test("BackPropConfig - default sparseRatio is 1", () => {
  const config = createBackPropagationConfig();
  assertAlmostEquals(config.sparseRatio, 1, 1e-9);
});

Deno.test("BackPropConfig - disableRandomSamples defaults to false", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.disableRandomSamples, false);
});

Deno.test("BackPropConfig - disableBiasAdjustment defaults to false", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.disableBiasAdjustment, false);
});

Deno.test("BackPropConfig - disableWeightAdjustment defaults to false", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.disableWeightAdjustment, false);
});

// ---------------------------------------------------------------------------
// createBackPropagationConfig - explicit overrides
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - respects explicit options", () => {
  const config = createBackPropagationConfig({
    disableRandomSamples: true,
    generations: 5,
    learningRate: 0.1,
    maximumBiasAdjustmentScale: 2,
    maximumWeightAdjustmentScale: 3,
    limitBiasScale: 500,
    limitWeightScale: 5000,
    plankConstant: 1e-8,
    batchSize: 32,
    learningRateStrategy: "fixed",
    sparseRatio: 0.8,
  });

  assertEquals(config.disableRandomSamples, true);
  assertEquals(config.generations, 5);
  assertEquals(config.learningRate, 0.1);
  assertEquals(config.maximumBiasAdjustmentScale, 2);
  assertEquals(config.maximumWeightAdjustmentScale, 3);
  assertEquals(config.limitBiasScale, 500);
  assertEquals(config.limitWeightScale, 5000);
  assertAlmostEquals(config.plankConstant, 1e-8, 1e-15);
  assertEquals(config.batchSize, 32);
  assertEquals(config.learningRateStrategy, "fixed");
  assertAlmostEquals(config.sparseRatio, 0.8, 1e-9);
});

Deno.test("BackPropConfig - can enable disableBiasAdjustment", () => {
  const config = createBackPropagationConfig({ disableBiasAdjustment: true });
  assertEquals(config.disableBiasAdjustment, true);
});

Deno.test("BackPropConfig - can enable disableWeightAdjustment", () => {
  const config = createBackPropagationConfig({
    disableWeightAdjustment: true,
  });
  assertEquals(config.disableWeightAdjustment, true);
});

// ---------------------------------------------------------------------------
// createBackPropagationConfig - clamping
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - learningRate clamped to [0.001, 1]", () => {
  const low = createBackPropagationConfig({
    learningRate: 0.0001,
    learningRateStrategy: "fixed",
  });
  assertEquals(low.learningRate, 0.001);

  const high = createBackPropagationConfig({
    learningRate: 5,
    learningRateStrategy: "fixed",
  });
  assertEquals(high.learningRate, 1);

  const neg = createBackPropagationConfig({ learningRate: -0.5 });
  assertGreater(neg.learningRate, 0);
});

Deno.test("BackPropConfig - generations clamped to non-negative", () => {
  const config = createBackPropagationConfig({ generations: -5 });
  assert(config.generations >= 0);
});

Deno.test("BackPropConfig - limitBiasScale minimum is 1", () => {
  const config = createBackPropagationConfig({ limitBiasScale: 0.5 });
  assertEquals(config.limitBiasScale, 1);
});

Deno.test("BackPropConfig - limitWeightScale minimum is 1", () => {
  const config = createBackPropagationConfig({ limitWeightScale: 0.1 });
  assertEquals(config.limitWeightScale, 1);
});

Deno.test("BackPropConfig - warmRestartPeriod minimum is 2", () => {
  const config = createBackPropagationConfig({ warmRestartPeriod: 1 });
  assertEquals(config.warmRestartPeriod, 2);
});

Deno.test("BackPropConfig - learningRateDecay clamped to [0.1, 1]", () => {
  const low = createBackPropagationConfig({ learningRateDecay: 0.01 });
  assertGreaterOrEqual(low.learningRateDecay, 0.1);

  const high = createBackPropagationConfig({ learningRateDecay: 2 });
  assertLessOrEqual(high.learningRateDecay, 1);
});

Deno.test("BackPropConfig - initialLearningRate clamped to [0.001, 1]", () => {
  const low = createBackPropagationConfig({ initialLearningRate: 0 });
  assertGreaterOrEqual(low.initialLearningRate, 0.001);

  const high = createBackPropagationConfig({ initialLearningRate: 5 });
  assertLessOrEqual(high.initialLearningRate, 1);
});

Deno.test("BackPropConfig - biasWeightCoordinationFactor clamped to [0, 1]", () => {
  const low = createBackPropagationConfig({
    biasWeightCoordinationFactor: -0.5,
  });
  assertEquals(low.biasWeightCoordinationFactor, 0);

  const high = createBackPropagationConfig({
    biasWeightCoordinationFactor: 2,
  });
  assertEquals(high.biasWeightCoordinationFactor, 1);
});

Deno.test("BackPropConfig - maximumBiasAdjustmentScale cannot be negative", () => {
  const config = createBackPropagationConfig({
    maximumBiasAdjustmentScale: -5,
  });
  assertGreaterOrEqual(config.maximumBiasAdjustmentScale, 0);
});

Deno.test("BackPropConfig - maximumWeightAdjustmentScale cannot be negative", () => {
  const config = createBackPropagationConfig({
    maximumWeightAdjustmentScale: -5,
  });
  assertGreaterOrEqual(config.maximumWeightAdjustmentScale, 0);
});

Deno.test("BackPropConfig - trainingMutationRate clamped to [0.01, 1]", () => {
  const low = createBackPropagationConfig({ trainingMutationRate: 0 });
  assertGreaterOrEqual(low.trainingMutationRate, 0.01);

  const high = createBackPropagationConfig({ trainingMutationRate: 5 });
  assertLessOrEqual(high.trainingMutationRate, 1);
});

// ---------------------------------------------------------------------------
// createBackPropagationConfig - strategy selection
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - explicit learningRate selects fixed strategy", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.05,
  });
  assertEquals(config.learningRateStrategy, "fixed");
});

Deno.test("BackPropConfig - explicit strategy override works", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "decay",
    learningRate: 0.1,
  });
  assertEquals(config.learningRateStrategy, "decay");
});

// ---------------------------------------------------------------------------
// calculateLearningRate - fixed strategy
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate - fixed returns constant rate", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.05,
    learningRateStrategy: "fixed",
  });
  assertEquals(calculateLearningRate(config, 0), 0.05);
  assertEquals(calculateLearningRate(config, 100), 0.05);
});

// ---------------------------------------------------------------------------
// calculateLearningRate - decay strategy
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate - decay decreases over iterations", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    learningRateStrategy: "decay",
  });
  const lr0 = calculateLearningRate(config, 0);
  const lr1 = calculateLearningRate(config, 1);
  const lr10 = calculateLearningRate(config, 10);

  assertAlmostEquals(lr0, 0.1, 1e-10);
  assertAlmostEquals(lr1, 0.1 * 0.9, 1e-10);
  assertAlmostEquals(lr10, 0.1 * Math.pow(0.9, 10), 1e-10);
  assert(lr1 < lr0, "Learning rate should decrease");
  assert(lr10 < lr1, "Learning rate should continue decreasing");
});

Deno.test("calculateLearningRate - decay monotonically decreases", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
  });

  let prev = calculateLearningRate(config, 0);
  for (let i = 1; i <= 20; i++) {
    const current = calculateLearningRate(config, i);
    assertGreater(
      prev,
      current,
      `Rate at iteration ${i} should be less than at ${i - 1}`,
    );
    assertGreater(current, 0, "Rate should stay positive");
    prev = current;
  }
});

// ---------------------------------------------------------------------------
// calculateLearningRate - adaptive strategy
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate - adaptive without feedback uses base rate", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    learningRateStrategy: "adaptive",
  });
  const lr = calculateLearningRate(config, 0);
  assertAlmostEquals(lr, 0.1, 1e-10);
});

Deno.test("calculateLearningRate - adaptive boosts when error improves", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    learningRateStrategy: "adaptive",
  });
  const lrNoFeedback = calculateLearningRate(config, 0);
  const lrImproving = calculateLearningRate(config, 0, {
    previousError: 1.0,
    currentError: 0.5,
  });

  assert(
    lrImproving > lrNoFeedback,
    "Improving error should boost learning rate",
  );
});

Deno.test("calculateLearningRate - adaptive reduces when error worsens", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    learningRateStrategy: "adaptive",
  });
  const lrNoFeedback = calculateLearningRate(config, 0);
  const lrWorsening = calculateLearningRate(config, 0, {
    previousError: 1.0,
    currentError: 2.0,
  });

  assert(
    lrWorsening < lrNoFeedback,
    "Worsening error should reduce learning rate",
  );
});

Deno.test("calculateLearningRate - adaptive stagnation boost escapes plateau", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const improving: ErrorFeedback = { previousError: 1.0, currentError: 0.5 };
  const stagnant: ErrorFeedback = { previousError: 1.0, currentError: 0.97 };
  const worsening: ErrorFeedback = { previousError: 1.0, currentError: 2.0 };

  const lrImprove = calculateLearningRate(config, 0, improving);
  const lrStagnant = calculateLearningRate(config, 0, stagnant);
  const lrWorsen = calculateLearningRate(config, 0, worsening);

  assertGreater(
    lrStagnant,
    lrImprove,
    "Stagnation boost should be highest to escape plateau",
  );
  assertGreater(
    lrStagnant,
    lrWorsen,
    "Stagnation boost should exceed worsening rate",
  );
});

Deno.test("calculateLearningRate - adaptive ignores non-finite feedback", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });
  const lr = calculateLearningRate(config, 0, {
    previousError: NaN,
    currentError: 0.5,
  });
  assertAlmostEquals(lr, 0.1, 1e-9, "Non-finite feedback should be ignored");
});

Deno.test("calculateLearningRate - adaptive ignores zero previousError", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });
  const lr = calculateLearningRate(config, 0, {
    previousError: 0,
    currentError: 0.5,
  });
  assertAlmostEquals(lr, 0.1, 1e-9);
});

// ---------------------------------------------------------------------------
// calculateLearningRate - warm_restart strategy
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate - warm_restart resets at period boundary", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    warmRestartPeriod: 10,
    learningRateStrategy: "warm_restart",
  });

  const lr0 = calculateLearningRate(config, 0);
  const lr10 = calculateLearningRate(config, 10);

  assertAlmostEquals(lr0, lr10, 1e-10);
});

Deno.test("calculateLearningRate - warm_restart mid-period has lower rate", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    warmRestartPeriod: 10,
    learningRateStrategy: "warm_restart",
  });

  const lrStart = calculateLearningRate(config, 0);
  const lrMid = calculateLearningRate(config, 5);

  assert(
    lrMid < lrStart,
    "Mid-period rate should be lower than start-of-period rate",
  );
});

// ---------------------------------------------------------------------------
// limitValue
// ---------------------------------------------------------------------------

Deno.test("limitValue - passes through normal values", () => {
  assertEquals(limitValue(0), 0);
  assertEquals(limitValue(42), 42);
  assertEquals(limitValue(-42), -42);
  assertAlmostEquals(limitValue(0.001), 0.001, 1e-12);
});

Deno.test("limitValue - very small values pass through", () => {
  assertAlmostEquals(limitValue(1e-15), 1e-15, 1e-20);
  assertAlmostEquals(limitValue(-1e-15), -1e-15, 1e-20);
});

Deno.test("limitValue - clamps large positive values to 1e12", () => {
  assertEquals(limitValue(1e13), 1e12);
  assertEquals(limitValue(1e20), 1e12);
});

Deno.test("limitValue - clamps large negative values to -1e12", () => {
  assertEquals(limitValue(-1e13), -1e12);
  assertEquals(limitValue(-1e20), -1e12);
});

Deno.test("limitValue - returns 0 for NaN", () => {
  assertEquals(limitValue(NaN), 0);
});

Deno.test("limitValue - clamps Infinity to 1e12", () => {
  assertEquals(limitValue(Infinity), 1e12);
});

Deno.test("limitValue - clamps -Infinity to -1e12", () => {
  assertEquals(limitValue(-Infinity), -1e12);
});

Deno.test("limitValue - boundary value 1e12 passes through", () => {
  assertAlmostEquals(limitValue(1e12), 1e12, 1);
  assertAlmostEquals(limitValue(-1e12), -1e12, 1);
});

Deno.test("limitValue - just over boundary is clamped", () => {
  assertEquals(limitValue(1e12 + 1), 1e12);
  assertEquals(limitValue(-1e12 - 1), -1e12);
});

Deno.test("limitValue - converts computed NaN values to 0", () => {
  assertEquals(limitValue(0 / 0), 0);
  assertEquals(limitValue(Infinity - Infinity), 0);
  assertEquals(limitValue(Infinity * 0), 0);
});

Deno.test("limitValue - handles negative zero", () => {
  assertEquals(limitValue(-0), 0);
});
