/**
 * Parametric test verifying the derivative-based calculateError() formula
 * across all activation functions.
 *
 * For activations with a non-vanishing derivative at a given point, the
 * error should equal: (targetActivation - currentActivation) / derivative.
 *
 * This consolidates the per-activation `check()` helper pattern that was
 * previously duplicated across 32 individual test files.
 *
 * Closes #1601
 *
 * @module
 */

import { assert, assertAlmostEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

/**
 * Activations that use the derivative formula: error = rawError / slope.
 * Activations like IDENTITY, ReLU, LeakyReLU, BIPOLAR, STEP, COMPLEMENT,
 * HARD_TANH, ABSOLUTE, ReLU6, SQRT, SQUARE, and StdInverse use different
 * approaches (direct rawError, unSquash-based, or custom logic).
 */
const DERIVATIVE_FORMULA_SQUASH_NAMES = [
  "ArcTan",
  "BENT_IDENTITY",
  "BIPOLAR_SIGMOID",
  "Cosine",
  "Cube",
  "ELU",
  "Exponential",
  "GAUSSIAN",
  "GELU",
  "ISRU",
  "LOGISTIC",
  "LogSigmoid",
  "Mish",
  "SELU",
  "SINE",
  "SOFTSIGN",
  "Softplus",
  "Swish",
  "TAN",
  "TANH",
];

/**
 * Value pairs (currentValue, targetValue) to test. These exercise both
 * the active-derivative and near-flat regions of various activations.
 */
const VALUE_PAIRS: [number, number][] = [
  [0.5, 1.0],
  [1.0, 0.5],
  [-0.5, 0.5],
  [0.3, 0.5],
  [1.0, 2.0],
  [-1.0, -0.5],
];

/**
 * Minimum derivative magnitude below which each activation uses a fallback
 * path rather than the derivative formula. We skip the formula check in
 * these regions since the fallback behaviour is tested separately.
 *
 * These thresholds match the actual implementation slope thresholds.
 */
const DERIVATIVE_THRESHOLDS: Record<string, number> = {
  "ELU": 1e-2,
  "GELU": 1e-2,
  "Mish": 1e-2,
  "SELU": 1e-2,
  "Swish": 1e-2,
};
const DEFAULT_DERIVATIVE_THRESHOLD = 1e-8;

// ============================================================================
// Parametric derivative formula verification
// ============================================================================
for (const name of DERIVATIVE_FORMULA_SQUASH_NAMES) {
  Deno.test(
    `${name}.calculateError: matches derivative formula in active region`,
    () => {
      const activation = Activations.find(name);
      const squash = activation as unknown as ActivationInterface;
      if (!activation.calculateError || !squash.derivative) return;

      for (const [currentValue, targetValue] of VALUE_PAIRS) {
        const act = squash.squash(currentValue);
        const target = squash.squash(targetValue);
        if (!Number.isFinite(act) || !Number.isFinite(target)) continue;

        const slope = squash.derivative(currentValue);

        // Only test the derivative formula when slope is significant
        const threshold = DERIVATIVE_THRESHOLDS[name] ??
          DEFAULT_DERIVATIVE_THRESHOLD;
        if (Math.abs(slope) <= threshold) continue;

        const expectedError = (target - act) / slope;
        const error = activation.calculateError(act, target, currentValue);

        assert(
          Number.isFinite(error),
          `${name}: error must be finite for (${currentValue}, ${targetValue})`,
        );

        // Clamp expected to [-100, 100] to match implementation clamping
        const clampedExpected = Math.max(
          Math.min(expectedError, 100),
          -100,
        );
        assertAlmostEquals(
          error,
          clampedExpected,
          0.001,
          `${name}: calculateError(${currentValue}, ${targetValue}) = ${error}, ` +
            `expected ≈ ${clampedExpected} [(target - act) / slope]`,
        );
      }
    },
  );
}

// ============================================================================
// Fallback behaviour: when derivative vanishes, error is still finite
// and directionally correct
// ============================================================================

/** Activations known to have vanishing derivatives in specific regions. */
const VANISHING_GRADIENT_CASES: { name: string; currentValue: number }[] = [
  { name: "TANH", currentValue: 5 }, // Near saturation
  { name: "TANH", currentValue: -5 },
  { name: "LOGISTIC", currentValue: 10 }, // Near saturation
  { name: "LOGISTIC", currentValue: -10 },
  { name: "GAUSSIAN", currentValue: 0 }, // Peak (derivative = 0)
  { name: "GAUSSIAN", currentValue: 4 }, // Tail
  { name: "ELU", currentValue: -10 }, // Deep negative
  { name: "SELU", currentValue: -10 },
  { name: "HARD_TANH", currentValue: 5 }, // Saturated region
  { name: "HARD_TANH", currentValue: -5 },
  { name: "ReLU", currentValue: -5 }, // Dead region
  { name: "ReLU6", currentValue: -5 }, // Below zero
  { name: "ReLU6", currentValue: 10 }, // Above 6
  { name: "Cosine", currentValue: 0 }, // cos'(0) = -sin(0) = 0
  { name: "ArcTan", currentValue: 20 }, // Flat tail
  { name: "LogSigmoid", currentValue: 20 }, // Flat tail
  { name: "Softplus", currentValue: -5 }, // Near-flat region
];

for (const { name, currentValue } of VANISHING_GRADIENT_CASES) {
  Deno.test(
    `${name}.calculateError: finite error in vanishing gradient region (x=${currentValue})`,
    () => {
      const activation = Activations.find(name);
      const squash = activation as unknown as ActivationInterface;
      if (!activation.calculateError) return;

      const act = squash.squash(currentValue);
      // Use a nearby target that differs from current
      const targetValue = currentValue + 0.5;
      const target = squash.squash(targetValue);
      if (!Number.isFinite(act) || !Number.isFinite(target)) return;

      const error = activation.calculateError(act, target, currentValue);
      assert(
        Number.isFinite(error),
        `${name}: error must be finite at x=${currentValue}, got ${error}`,
      );
    },
  );
}

// ============================================================================
// Discrete activations: exact magnitude tests for threshold crossing
// ============================================================================

Deno.test("BIPOLAR.calculateError: magnitude when crossing threshold", () => {
  const bipolar = Activations.find("BIPOLAR");
  if (!bipolar.calculateError) return;

  // From negative side to positive target
  const error1 = bipolar.calculateError(-1, 1, -0.5);
  assertAlmostEquals(error1, 1.5, 1e-10, "Error should be 1.5 from -0.5");

  const error2 = bipolar.calculateError(-1, 1, -5);
  assertAlmostEquals(error2, 6.0, 1e-10, "Error should be 6.0 from -5");

  // From positive side to negative target
  const error3 = bipolar.calculateError(1, -1, 1);
  assertAlmostEquals(error3, -2.0, 1e-10, "Error should be -2.0 from 1");
});

Deno.test("STEP.calculateError: magnitude when crossing threshold", () => {
  const step = Activations.find("STEP");
  if (!step.calculateError) return;

  // From below threshold to target=1
  assertAlmostEquals(step.calculateError(0, 1, -1), 2.0, 1e-10);
  assertAlmostEquals(step.calculateError(0, 1, -5), 6.0, 1e-10);
  assertAlmostEquals(step.calculateError(0, 1, -0.1), 1.1, 1e-10);

  // From above threshold to target=0
  assertAlmostEquals(step.calculateError(1, 0, 1), -1.0, 1e-10);
  assertAlmostEquals(step.calculateError(1, 0, 5), -5.0, 1e-10);
  assertAlmostEquals(step.calculateError(1, 0, 0.1), -0.1, 1e-10);
});

Deno.test("STEP.calculateError: at threshold boundary", () => {
  const step = Activations.find("STEP");
  const squash = step as unknown as ActivationInterface;
  if (!step.calculateError) return;

  // At x=0, squash(0) = 0
  assertAlmostEquals(squash.squash(0), 0, 1e-10);
  assertAlmostEquals(step.calculateError(0, 1, 0), 1.0, 1e-10);
  assertAlmostEquals(step.calculateError(0, 0, 0), 0.0, 1e-10);

  // Just above threshold
  const epsilon = 0.0001;
  assertAlmostEquals(step.calculateError(1, 0, epsilon), -epsilon, 1e-10);

  // Just below threshold
  assertAlmostEquals(step.calculateError(0, 1, -epsilon), 1 + epsilon, 1e-10);
});

Deno.test("ReLU.calculateError: flat region with specific hint", () => {
  const relu = Activations.find("ReLU");
  if (!relu.calculateError) return;

  // currentActivation=0, targetActivation=1, raw=-10
  // Uses unSquash fallback: error = unSquash(1, -10) - (-10) = 1 - (-10) = 11
  const error = relu.calculateError(0, 1, -10);
  assertAlmostEquals(error, 11.0, 1e-10);
});

Deno.test("ReLU6.calculateError: magnitude in active zone", () => {
  const relu6 = Activations.find("ReLU6");
  if (!relu6.calculateError) return;

  // In active zone (0 < x < 6), error = target - currentValue
  assertAlmostEquals(relu6.calculateError(3, 4, 3), 1.0, 1e-10);
  assertAlmostEquals(relu6.calculateError(2, 5, 2), 3.0, 1e-10);
  assertAlmostEquals(relu6.calculateError(4, 1, 4), -3.0, 1e-10);
});

Deno.test("IDENTITY.calculateError: exact error values", () => {
  const id = Activations.find("IDENTITY");
  if (!id.calculateError) return;

  assertAlmostEquals(id.calculateError(0.5, 0.5, 0.5), 0, 1e-10);
  assertAlmostEquals(id.calculateError(0.2, 0.5, 0.2), 0.3, 1e-10);
  assertAlmostEquals(id.calculateError(1.0, 0.5, 1.0), -0.5, 1e-10);
});

Deno.test("IDENTITY.calculateError: extreme values are clamped", () => {
  const id = Activations.find("IDENTITY");
  if (!id.calculateError) return;

  const err = id.calculateError(
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  assertAlmostEquals(err, -100, 1e-10);
});
