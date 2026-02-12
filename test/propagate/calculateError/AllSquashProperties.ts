/**
 * Systematic property tests for calculateError() across all squash functions.
 *
 * These tests verify mathematical properties that MUST hold for every squash
 * function's calculateError() implementation:
 *
 * 1. Perfect match returns zero error
 * 2. Error is always finite (never NaN or Infinity)
 * 3. Error direction is correct (pushes toward target)
 * 4. Error is clamped within [-100, 100]
 *
 * Closes #1389
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

/**
 * All standard (non-aggregate, non-deprecated) squash function names.
 */
const STANDARD_SQUASH_NAMES = [
  "ABSOLUTE",
  "ArcTan",
  "BENT_IDENTITY",
  "BIPOLAR",
  "BIPOLAR_SIGMOID",
  "COMPLEMENT",
  "Cosine",
  "Cube",
  "ELU",
  "Exponential",
  "GAUSSIAN",
  "GELU",
  "HARD_TANH",
  "IDENTITY",
  "ISRU",
  "LeakyReLU",
  "LOGISTIC",
  "LogSigmoid",
  "Mish",
  "ReLU",
  "ReLU6",
  "SELU",
  "SINE",
  "SOFTSIGN",
  "Softplus",
  "SQRT",
  "SQUARE",
  "STEP",
  "StdInverse",
  "Swish",
  "TAN",
  "TANH",
];

/**
 * Test values covering typical, boundary, and extreme inputs.
 * Chosen to exercise both the derivative path and fallback path.
 */
const TEST_VALUES = [
  0,
  0.001,
  -0.001,
  0.5,
  -0.5,
  1,
  -1,
  2,
  -2,
  5,
  -5,
  10,
  -10,
];

// ============================================================================
// Property 1: Perfect match returns zero error
// ============================================================================
for (const name of STANDARD_SQUASH_NAMES) {
  Deno.test(`${name}.calculateError: zero error on perfect match`, () => {
    const activation = Activations.find(name);
    const squash = activation as unknown as ActivationInterface;
    if (!activation.calculateError) return;

    for (const value of TEST_VALUES) {
      const act = squash.squash(value);
      if (!Number.isFinite(act)) continue;

      const error = activation.calculateError(act, act, value);
      assertAlmostEquals(
        error,
        0,
        1e-6,
        `${name}: perfect match at value=${value} should yield zero error, got ${error}`,
      );
    }
  });
}

// ============================================================================
// Property 2: Error is always finite
// ============================================================================
for (const name of STANDARD_SQUASH_NAMES) {
  Deno.test(`${name}.calculateError: always produces finite error`, () => {
    const activation = Activations.find(name);
    const squash = activation as unknown as ActivationInterface;
    if (!activation.calculateError) return;

    // Test with various current/target value pairs
    const valuePairs = [
      [0, 1],
      [1, 0],
      [-1, 1],
      [0.5, -0.5],
      [0.1, 0.9],
      [-2, 2],
      [5, -5],
      [0, 0.001],
      [10, -10],
    ];

    for (const [currentVal, targetVal] of valuePairs) {
      const currentAct = squash.squash(currentVal);
      const targetAct = squash.squash(targetVal);
      if (!Number.isFinite(currentAct) || !Number.isFinite(targetAct)) {
        continue;
      }

      const error = activation.calculateError(
        currentAct,
        targetAct,
        currentVal,
      );
      assert(
        Number.isFinite(error),
        `${name}: error must be finite for values (${currentVal}, ${targetVal}), got ${error}`,
      );
    }
  });
}

// ============================================================================
// Property 3: A small step in the error direction improves activation
// ============================================================================
for (const name of STANDARD_SQUASH_NAMES) {
  Deno.test(`${name}.calculateError: small step improves activation`, () => {
    const activation = Activations.find(name);
    const squash = activation as unknown as ActivationInterface;
    if (!activation.calculateError) return;

    // For each test case, verify that applying a small fraction of the
    // error moves the activation closer to the target. A full step can
    // overshoot for steep functions, so we test with a small learning
    // rate to verify the gradient direction is correct.
    //
    // We use small deltas between current and target to stay within the
    // locally linear region where derivative-based error is accurate.
    const testCases = [
      { currentVal: 0.5, targetVal: 0.6 },
      { currentVal: 1, targetVal: 0.9 },
      { currentVal: 0.3, targetVal: 0.5 },
      { currentVal: 0.2, targetVal: 0.1 },
    ];

    for (const { currentVal, targetVal } of testCases) {
      const currentAct = squash.squash(currentVal);
      const targetAct = squash.squash(targetVal);
      if (!Number.isFinite(currentAct) || !Number.isFinite(targetAct)) {
        continue;
      }

      // Skip if activations are already equal (within epsilon)
      if (Math.abs(targetAct - currentAct) < 1e-6) continue;

      const error = activation.calculateError(
        currentAct,
        targetAct,
        currentVal,
      );

      // Skip if error is too small to be meaningful
      if (Math.abs(error) < 1e-6) continue;

      // Apply a small fraction of the error (learning rate)
      const smallStep = error * 0.01;
      const improvedValue = currentVal + smallStep;
      const improvedAct = squash.squash(improvedValue);

      const currentDistance = Math.abs(targetAct - currentAct);
      const improvedDistance = Math.abs(targetAct - improvedAct);

      assert(
        improvedDistance <= currentDistance + 1e-6,
        `${name}: small step in error direction should not increase distance ` +
          `for (${currentVal}->${targetVal}). ` +
          `currentDist=${currentDistance.toFixed(6)}, ` +
          `improvedDist=${improvedDistance.toFixed(6)}, ` +
          `error=${error.toFixed(6)}`,
      );
    }
  });
}

// ============================================================================
// Property 4: Error is clamped within [-100, 100]
// ============================================================================
for (const name of STANDARD_SQUASH_NAMES) {
  Deno.test(`${name}.calculateError: error is clamped within bounds`, () => {
    const activation = Activations.find(name);
    const squash = activation as unknown as ActivationInterface;
    if (!activation.calculateError) return;

    // Use extreme value differences to try to produce large errors
    const extremePairs = [
      [0, 100],
      [100, 0],
      [-100, 100],
      [0.001, 50],
      [-50, 0.001],
    ];

    for (const [currentVal, targetVal] of extremePairs) {
      const currentAct = squash.squash(currentVal);
      const targetAct = squash.squash(targetVal);
      if (!Number.isFinite(currentAct) || !Number.isFinite(targetAct)) {
        continue;
      }

      const error = activation.calculateError(
        currentAct,
        targetAct,
        currentVal,
      );

      assert(
        error >= -100 && error <= 100,
        `${name}: error ${error} exceeds [-100, 100] bounds ` +
          `for values (${currentVal}, ${targetVal})`,
      );
    }
  });
}
