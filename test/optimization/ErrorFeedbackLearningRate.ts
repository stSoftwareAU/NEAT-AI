import { assert, assertAlmostEquals } from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";

Deno.test("optimization/ErrorFeedback - adaptive rate increases when error stagnates", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Simulate stagnation: error barely changes across iterations
  const stagnantRate = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.499,
  });

  // Simulate improvement: error is decreasing noticeably
  const improvingRate = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.3,
  });

  // When stagnating, the learning rate should be higher to escape the plateau
  assert(
    stagnantRate > improvingRate,
    `Stagnant rate (${stagnantRate}) should be > improving rate (${improvingRate})`,
  );
});

Deno.test("optimization/ErrorFeedback - adaptive rate decreases when error increases", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Error got worse: learning rate should decrease
  const worseRate = calculateLearningRate(config, 5, {
    previousError: 0.3,
    currentError: 0.5,
  });

  // Error improved: learning rate should be maintained
  const betterRate = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.3,
  });

  assert(
    worseRate < betterRate,
    `Worsening rate (${worseRate}) should be < improving rate (${betterRate})`,
  );
});

Deno.test("optimization/ErrorFeedback - fixed and decay strategies ignore error feedback", () => {
  const fixedConfig = createBackPropagationConfig({
    learningRateStrategy: "fixed",
    learningRate: 0.05,
  });

  const decayConfig = createBackPropagationConfig({
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Fixed strategy should return the same rate regardless of error feedback
  const fixedWithFeedback = calculateLearningRate(fixedConfig, 5, {
    previousError: 0.5,
    currentError: 0.3,
  });
  const fixedWithoutFeedback = calculateLearningRate(fixedConfig, 5);
  assertAlmostEquals(fixedWithFeedback, fixedWithoutFeedback, 1e-12);

  // Decay strategy should return the same rate regardless of error feedback
  const decayWithFeedback = calculateLearningRate(decayConfig, 5, {
    previousError: 0.5,
    currentError: 0.3,
  });
  const decayWithoutFeedback = calculateLearningRate(decayConfig, 5);
  assertAlmostEquals(decayWithFeedback, decayWithoutFeedback, 1e-12);
});

Deno.test("optimization/ErrorFeedback - adaptive without error feedback falls back to decay-based rate", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Without error feedback, errorAdjustment=1 and magnitudeScale=1
  // so rate = initialLearningRate * sqrt(learningRateDecay)^iteration
  const rate = calculateLearningRate(config, 5);
  const expected = 0.1 * Math.pow(Math.sqrt(0.95), 5);
  assertAlmostEquals(rate, expected, 1e-9);
});

Deno.test("optimization/ErrorFeedback - adaptive rate bounded: stagnation boosts, worsening reduces", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Extreme stagnation: errorRatio ≈ 1.0, so errorAdjustment = 1.3 (stagnation boost)
  // magnitudeScale = 1 + 0.4999999/(1+0.4999999) ≈ 1.333
  const extremeStagnation = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.4999999,
  });
  const baseAtIter5 = 0.1 * Math.pow(Math.sqrt(0.95), 5);
  // With stagnation: 1.3 boost * magnitude scaling
  const expectedStagnation = baseAtIter5 * 1.3 *
    (1 + 0.4999999 / (1 + 0.4999999));
  assertAlmostEquals(extremeStagnation, expectedStagnation, 1e-9);

  // Worsening error: ratio = 0.9/0.1 = 9.0, errorAdjustment = max(0.5, 1/9) ≈ 0.5
  // magnitudeScale = 1 + 0.9/(1+0.9) ≈ 1.4737
  const worseError = calculateLearningRate(config, 5, {
    previousError: 0.1,
    currentError: 0.9,
  });
  const expectedWorse = baseAtIter5 * 0.5 * (1 + 0.9 / (1 + 0.9));
  assertAlmostEquals(worseError, expectedWorse, 1e-9);
});
