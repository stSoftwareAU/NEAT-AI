/**
 * Issue #1480: Tests for error-magnitude scaling in the adaptive learning rate strategy.
 *
 * Verifies that the adaptive strategy scales the learning rate proportionally
 * to error magnitude — larger steps when error is large (far from optimum),
 * smaller steps when error is small (fine-tuning region).
 */
import {
  assertAlmostEquals,
  assertGreater,
  assertLessOrEqual,
} from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
  type ErrorFeedback,
} from "../../src/propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// Magnitude scaling: large error produces higher learning rate
// ---------------------------------------------------------------------------

Deno.test("AdaptiveMagnitudeScaling - large error produces higher rate than small error", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.01,
    learningRateDecay: 0.95,
  });

  // Large error scenario: currentError = 0.8, improving from 0.9
  const largeErrorFeedback: ErrorFeedback = {
    previousError: 0.9,
    currentError: 0.8,
  };

  // Small error scenario: currentError = 0.01, improving from 0.02
  const smallErrorFeedback: ErrorFeedback = {
    previousError: 0.02,
    currentError: 0.01,
  };

  const lrLargeError = calculateLearningRate(config, 0, largeErrorFeedback);
  const lrSmallError = calculateLearningRate(config, 0, smallErrorFeedback);

  // Both are improving (ratio < 0.95), so direction adjustment is the same (1.1).
  // But magnitude scaling should make the large-error rate higher.
  assertGreater(
    lrLargeError,
    lrSmallError,
    "Large error should produce a higher adaptive learning rate",
  );
});

Deno.test("AdaptiveMagnitudeScaling - magnitude scale approaches 2x for very large errors", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.01,
    learningRateDecay: 1.0, // No decay, to isolate magnitude effect
  });

  // Very large error: normalisedError ≈ 1, so magnitudeScale ≈ 2.0
  const hugeErrorFeedback: ErrorFeedback = {
    previousError: 200,
    currentError: 100,
  };
  const lrHugeError = calculateLearningRate(config, 0, hugeErrorFeedback);

  // With no decay (factor=1), improving (adjustment=1.1), magnitudeScale ≈ 2.0:
  // expected ≈ 0.01 * 1.0 * 1.1 * ~1.99 ≈ 0.0219
  assertGreater(
    lrHugeError,
    0.01 * 1.1 * 1.9,
    "Magnitude scale should approach 2x for large errors",
  );
  assertLessOrEqual(
    lrHugeError,
    0.01 * 1.1 * 2.0,
    "Magnitude scale should not exceed 2x",
  );
});

Deno.test("AdaptiveMagnitudeScaling - magnitude scale is 1x when error is near zero", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.01,
    learningRateDecay: 1.0,
  });

  // Very small error: normalisedError ≈ 0, so magnitudeScale ≈ 1.0
  const tinyErrorFeedback: ErrorFeedback = {
    previousError: 0.001,
    currentError: 0.0005,
  };
  const lrTinyError = calculateLearningRate(config, 0, tinyErrorFeedback);

  // Expected ≈ 0.01 * 1.0 * 1.1 * ~1.0005 ≈ 0.011
  assertAlmostEquals(
    lrTinyError,
    0.01 * 1.1 * (1 + 0.0005 / 1.0005),
    1e-6,
    "Magnitude scale should be near 1x for tiny errors",
  );
});

// ---------------------------------------------------------------------------
// Magnitude scaling interacts correctly with direction adjustment
// ---------------------------------------------------------------------------

Deno.test("AdaptiveMagnitudeScaling - worsening error still reduces rate despite large magnitude", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.01,
    learningRateDecay: 1.0,
  });

  // Error worsened (ratio > 1): currentError = 1.0, previous = 0.5
  const worseningFeedback: ErrorFeedback = {
    previousError: 0.5,
    currentError: 1.0,
  };

  const lr = calculateLearningRate(config, 0, worseningFeedback);

  // Direction adjustment = max(0.5, 1/2.0) = 0.5
  // Magnitude scale = 1 + (1 / (1 + 1)) = 1.5
  // Expected = 0.01 * 1.0 * 0.5 * 1.5 = 0.0075
  assertAlmostEquals(lr, 0.0075, 1e-6);
});

Deno.test("AdaptiveMagnitudeScaling - stagnation with moderate error boosts appropriately", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.01,
    learningRateDecay: 1.0,
  });

  // Stagnation (ratio ≈ 0.97): currentError = 0.485, previous = 0.5
  const stagnantFeedback: ErrorFeedback = {
    previousError: 0.5,
    currentError: 0.485,
  };

  const lr = calculateLearningRate(config, 0, stagnantFeedback);

  // Direction adjustment = 1.3 (stagnation)
  // Magnitude scale = 1 + (0.485 / 1.485) ≈ 1.3266
  // Expected ≈ 0.01 * 1.0 * 1.3 * 1.3266 ≈ 0.01725
  const expectedMagnitude = 1 + 0.485 / (1 + 0.485);
  assertAlmostEquals(lr, 0.01 * 1.3 * expectedMagnitude, 1e-6);
});

// ---------------------------------------------------------------------------
// Non-adaptive strategies are unaffected
// ---------------------------------------------------------------------------

Deno.test("AdaptiveMagnitudeScaling - fixed strategy unaffected by error magnitude", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "fixed",
    learningRate: 0.01,
  });

  const feedbackLarge: ErrorFeedback = {
    previousError: 1.0,
    currentError: 0.8,
  };
  const feedbackSmall: ErrorFeedback = {
    previousError: 0.01,
    currentError: 0.005,
  };

  const lr1 = calculateLearningRate(config, 0, feedbackLarge);
  const lr2 = calculateLearningRate(config, 0, feedbackSmall);

  assertAlmostEquals(lr1, 0.01, 1e-9, "Fixed strategy ignores error feedback");
  assertAlmostEquals(lr2, 0.01, 1e-9, "Fixed strategy ignores error feedback");
});

Deno.test("AdaptiveMagnitudeScaling - no feedback falls back to magnitude scale of 1", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.01,
    learningRateDecay: 1.0,
  });

  // Without feedback, errorAdjustment=1 and magnitudeScale=1
  const lr = calculateLearningRate(config, 0);
  assertAlmostEquals(
    lr,
    0.01,
    1e-9,
    "No feedback should use magnitude scale of 1",
  );
});

Deno.test("AdaptiveMagnitudeScaling - magnitude scale is monotonically increasing with error", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.01,
    learningRateDecay: 1.0,
  });

  // Test with a series of increasing errors, all with the same improvement ratio
  const errors = [0.001, 0.01, 0.1, 0.5, 1.0, 5.0, 100.0];
  const rates: number[] = [];

  for (const error of errors) {
    const feedback: ErrorFeedback = {
      previousError: error * 1.2, // Same ratio = 0.833... (improving)
      currentError: error,
    };
    rates.push(calculateLearningRate(config, 0, feedback));
  }

  // Each rate should be >= the previous one (monotonically increasing with error)
  for (let i = 1; i < rates.length; i++) {
    assertGreater(
      rates[i],
      rates[i - 1],
      `Rate at error=${errors[i]} should exceed rate at error=${errors[i - 1]}`,
    );
  }
});
