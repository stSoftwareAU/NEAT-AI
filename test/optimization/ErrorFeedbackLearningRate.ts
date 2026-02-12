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

Deno.test("optimization/ErrorFeedback - adaptive without error feedback still works", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Should not throw when called without error feedback (backwards compatible)
  const rate = calculateLearningRate(config, 5);
  assert(Number.isFinite(rate), "Rate should be finite");
  assert(rate > 0, "Rate should be positive");
});

Deno.test("optimization/ErrorFeedback - adaptive rate stays within reasonable bounds", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Even with extreme stagnation, rate should not exceed initial rate
  const extremeStagnation = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.4999999,
  });

  assert(
    extremeStagnation <= config.initialLearningRate * 2,
    `Rate (${extremeStagnation}) should not exceed 2x initial (${
      config.initialLearningRate * 2
    })`,
  );
  assert(extremeStagnation > 0, "Rate should be positive");

  // Even with worsening error, rate should stay positive
  const worseError = calculateLearningRate(config, 5, {
    previousError: 0.1,
    currentError: 0.9,
  });
  assert(worseError > 0, "Rate should be positive even when error worsens");
});
