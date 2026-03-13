import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
  limitValue,
} from "../../src/propagate/BackPropagation.ts";

// --- createBackPropagationConfig ---

Deno.test("createBackPropagationConfig - default config is frozen", () => {
  const config = createBackPropagationConfig({ disableRandomSamples: true });
  assertEquals(Object.isFrozen(config), true);
});

Deno.test("createBackPropagationConfig - respects explicit options", () => {
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
  });

  assertEquals(config.disableRandomSamples, true);
  assertEquals(config.generations, 5);
  assertEquals(config.learningRate, 0.1);
  assertEquals(config.maximumBiasAdjustmentScale, 2);
  assertEquals(config.maximumWeightAdjustmentScale, 3);
  assertEquals(config.limitBiasScale, 500);
  assertEquals(config.limitWeightScale, 5000);
  assertEquals(config.plankConstant, 1e-8);
  assertEquals(config.batchSize, 32);
  assertEquals(config.learningRateStrategy, "fixed");
});

Deno.test("createBackPropagationConfig - enforces minimum learning rate", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.0001,
    learningRateStrategy: "fixed",
  });
  assertEquals(config.learningRate, 0.001);
});

Deno.test("createBackPropagationConfig - enforces maximum learning rate", () => {
  const config = createBackPropagationConfig({
    learningRate: 5,
    learningRateStrategy: "fixed",
  });
  assertEquals(config.learningRate, 1);
});

Deno.test("createBackPropagationConfig - generations cannot be negative", () => {
  const config = createBackPropagationConfig({ generations: -5 });
  assert(config.generations >= 0);
});

Deno.test("createBackPropagationConfig - limitBiasScale minimum is 1", () => {
  const config = createBackPropagationConfig({ limitBiasScale: 0.5 });
  assertEquals(config.limitBiasScale, 1);
});

Deno.test("createBackPropagationConfig - limitWeightScale minimum is 1", () => {
  const config = createBackPropagationConfig({ limitWeightScale: 0.1 });
  assertEquals(config.limitWeightScale, 1);
});

Deno.test("createBackPropagationConfig - warmRestartPeriod minimum is 2", () => {
  const config = createBackPropagationConfig({ warmRestartPeriod: 1 });
  assertEquals(config.warmRestartPeriod, 2);
});

Deno.test("createBackPropagationConfig - learningRateDecay clamped to [0.1, 1]", () => {
  const low = createBackPropagationConfig({ learningRateDecay: 0.01 });
  assertEquals(low.learningRateDecay, 0.1);

  const high = createBackPropagationConfig({ learningRateDecay: 2 });
  assertEquals(high.learningRateDecay, 1);
});

Deno.test("createBackPropagationConfig - biasWeightCoordinationFactor clamped to [0, 1]", () => {
  const low = createBackPropagationConfig({
    biasWeightCoordinationFactor: -0.5,
  });
  assertEquals(low.biasWeightCoordinationFactor, 0);

  const high = createBackPropagationConfig({
    biasWeightCoordinationFactor: 2,
  });
  assertEquals(high.biasWeightCoordinationFactor, 1);
});

Deno.test("createBackPropagationConfig - explicit learningRate selects fixed strategy", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.05,
  });
  assertEquals(config.learningRateStrategy, "fixed");
});

// --- calculateLearningRate ---

Deno.test("calculateLearningRate - fixed strategy returns learningRate", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.05,
    learningRateStrategy: "fixed",
  });
  assertEquals(calculateLearningRate(config, 0), 0.05);
  assertEquals(calculateLearningRate(config, 100), 0.05);
});

Deno.test("calculateLearningRate - decay strategy decays over iterations", () => {
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

Deno.test("calculateLearningRate - adaptive strategy without feedback", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    learningRateStrategy: "adaptive",
  });
  const lr = calculateLearningRate(config, 0);
  // Without feedback, errorAdjustment=1 and magnitudeScale=1
  assertAlmostEquals(lr, 0.1, 1e-10);
});

Deno.test("calculateLearningRate - adaptive strategy with improving error boosts rate", () => {
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

  // Improving (ratio 0.5 < 0.95) => errorAdjustment = 1.1
  // magnitudeScale = 1 + 0.5/(1+0.5) = 1 + 1/3 ≈ 1.333
  assert(
    lrImproving > lrNoFeedback,
    "Improving error should boost learning rate",
  );
});

Deno.test("calculateLearningRate - adaptive strategy with stagnating error increases rate", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    learningRateStrategy: "adaptive",
  });
  const lrStagnating = calculateLearningRate(config, 0, {
    previousError: 1.0,
    currentError: 0.97,
  });
  // Stagnating (ratio 0.97 >= 0.95 and < 1.0) => errorAdjustment = 1.3
  const baseRate = 0.1;
  const magnitudeScale = 1 + 0.97 / (1 + 0.97);
  assertAlmostEquals(lrStagnating, baseRate * 1.3 * magnitudeScale, 1e-10);
});

Deno.test("calculateLearningRate - adaptive strategy with worsening error reduces rate", () => {
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

  // Worsening: errorAdjustment = max(0.5, 1.0/2.0) = 0.5
  assert(
    lrWorsening < lrNoFeedback,
    "Worsening error should reduce learning rate",
  );
});

Deno.test("calculateLearningRate - warm_restart resets at period boundary", () => {
  const config = createBackPropagationConfig({
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
    warmRestartPeriod: 10,
    learningRateStrategy: "warm_restart",
  });

  const lr0 = calculateLearningRate(config, 0);
  const lr10 = calculateLearningRate(config, 10);

  // At period boundaries (0 and 10), position is 0 => cos(0) = 1 => lr = lrMax
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

// --- limitValue ---

Deno.test("limitValue - passes through normal values", () => {
  assertEquals(limitValue(0), 0);
  assertEquals(limitValue(42), 42);
  assertEquals(limitValue(-42), -42);
  assertEquals(limitValue(0.001), 0.001);
});

Deno.test("limitValue - clamps large positive values", () => {
  assertEquals(limitValue(1e13), 1e12);
  assertEquals(limitValue(1e20), 1e12);
});

Deno.test("limitValue - clamps large negative values", () => {
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
  assertEquals(limitValue(1e12), 1e12);
  assertEquals(limitValue(-1e12), -1e12);
});
