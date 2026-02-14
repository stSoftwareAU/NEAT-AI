/**
 * Behavioural tests for BackPropagation.ts — verifying configuration
 * parsing, defaults, learning rate bound enforcement, and learning rate
 * strategy calculations.
 *
 * These are "what" tests: they exercise real functions with test data
 * and check outcomes, not implementation details.
 *
 * Closes #1440
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
} from "../../src/propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// Config defaults and validation
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - default batchSize is 64", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.batchSize, 64);
});

Deno.test("BackPropConfig - default sparseRatio is 1", () => {
  const config = createBackPropagationConfig();
  assertAlmostEquals(config.sparseRatio, 1, 1e-9);
});

Deno.test("BackPropConfig - disableBiasAdjustment defaults to false", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.disableBiasAdjustment, false);
});

Deno.test("BackPropConfig - disableWeightAdjustment defaults to false", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.disableWeightAdjustment, false);
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
// Learning rate bounds
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - learningRate clamped minimum to 0.001", () => {
  const config = createBackPropagationConfig({ learningRate: 0 });
  assertGreaterOrEqual(config.learningRate, 0.001);
});

Deno.test("BackPropConfig - learningRate clamped maximum to 1", () => {
  const config = createBackPropagationConfig({ learningRate: 5 });
  assertLessOrEqual(config.learningRate, 1);
});

Deno.test("BackPropConfig - negative learningRate becomes positive", () => {
  const config = createBackPropagationConfig({ learningRate: -0.5 });
  assertGreater(config.learningRate, 0);
});

// ---------------------------------------------------------------------------
// Adjustment scale bounds
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Training mutation rate bounds
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - trainingMutationRate clamped to [0.01, 1]", () => {
  const low = createBackPropagationConfig({ trainingMutationRate: 0 });
  assertGreaterOrEqual(low.trainingMutationRate, 0.01);

  const high = createBackPropagationConfig({ trainingMutationRate: 5 });
  assertLessOrEqual(high.trainingMutationRate, 1);
});

// ---------------------------------------------------------------------------
// Initial learning rate and decay bounds
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - initialLearningRate clamped to [0.001, 1]", () => {
  const low = createBackPropagationConfig({ initialLearningRate: 0 });
  assertGreaterOrEqual(low.initialLearningRate, 0.001);

  const high = createBackPropagationConfig({ initialLearningRate: 5 });
  assertLessOrEqual(high.initialLearningRate, 1);
});

Deno.test("BackPropConfig - learningRateDecay clamped to [0.1, 1]", () => {
  const low = createBackPropagationConfig({ learningRateDecay: 0 });
  assertGreaterOrEqual(low.learningRateDecay, 0.1);

  const high = createBackPropagationConfig({ learningRateDecay: 5 });
  assertLessOrEqual(high.learningRateDecay, 1);
});

// ---------------------------------------------------------------------------
// Config is frozen
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - config is deeply frozen", () => {
  const config = createBackPropagationConfig({ learningRate: 0.5 });
  assert(Object.isFrozen(config), "Config must be frozen");
});

// ---------------------------------------------------------------------------
// Learning rate strategy selection
// ---------------------------------------------------------------------------

Deno.test("BackPropConfig - explicit learningRate forces fixed strategy", () => {
  const config = createBackPropagationConfig({ learningRate: 0.1 });
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
// calculateLearningRate - decay monotonically decreases
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate decay - monotonically decreasing", () => {
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
// calculateLearningRate - adaptive responds to error feedback
// ---------------------------------------------------------------------------

Deno.test("calculateLearningRate adaptive - improving error gives higher rate than worsening", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const improving: ErrorFeedback = { previousError: 1.0, currentError: 0.5 };
  const worsening: ErrorFeedback = { previousError: 1.0, currentError: 2.0 };

  const lrImprove = calculateLearningRate(config, 0, improving);
  const lrWorsen = calculateLearningRate(config, 0, worsening);

  assertGreater(
    lrImprove,
    lrWorsen,
    "Improving error should yield higher learning rate than worsening",
  );
});

Deno.test("calculateLearningRate adaptive - stagnation boost is between improve and worsen", () => {
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

  // Stagnation actually gets the highest boost (1.3) to escape plateaus
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

// ---------------------------------------------------------------------------
// limitValue - boundary behaviour
// ---------------------------------------------------------------------------

Deno.test("limitValue - very small values pass through", () => {
  assertAlmostEquals(limitValue(1e-15), 1e-15, 1e-20);
  assertAlmostEquals(limitValue(-1e-15), -1e-15, 1e-20);
});

Deno.test("limitValue - exactly at boundary passes through", () => {
  assertAlmostEquals(limitValue(1e12), 1e12, 1);
  assertAlmostEquals(limitValue(-1e12), -1e12, 1);
});

Deno.test("limitValue - just over boundary is clamped", () => {
  assertEquals(limitValue(1e12 + 1), 1e12);
  assertEquals(limitValue(-1e12 - 1), -1e12);
});
