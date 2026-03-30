import { assert, assertAlmostEquals } from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
} from "@propagate/BackPropagation.ts";

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

Deno.test("optimization/ErrorFeedback - adaptive rate is bounded: stagnation boosts above base, worsening reduces below base", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Base rate without error feedback (uses decay only)
  const baseRate = calculateLearningRate(config, 5);

  // Extreme stagnation: error barely changes → rate should be boosted above base
  const extremeStagnation = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.4999999,
  });
  assert(
    extremeStagnation > baseRate,
    `Stagnation rate (${extremeStagnation}) should exceed base rate (${baseRate})`,
  );

  // Worsening error: error increased significantly → rate should be reduced below base
  const worseError = calculateLearningRate(config, 5, {
    previousError: 0.1,
    currentError: 0.9,
  });
  assert(
    worseError < baseRate,
    `Worsening rate (${worseError}) should be below base rate (${baseRate})`,
  );

  // Both rates should still be positive and finite (bounded)
  assert(extremeStagnation > 0, "Stagnation rate must be positive");
  assert(Number.isFinite(extremeStagnation), "Stagnation rate must be finite");
  assert(worseError > 0, "Worsening rate must be positive");
  assert(Number.isFinite(worseError), "Worsening rate must be finite");
});
