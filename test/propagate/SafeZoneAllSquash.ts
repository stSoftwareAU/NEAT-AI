/**
 * Property tests for safeZoneAdjustment() across all squash functions
 * that implement it.
 *
 * These tests verify universal properties that MUST hold for every
 * safeZoneAdjustment() implementation:
 *
 * 1. Return value is always in [0, 1]
 * 2. Non-finite raw input always returns 0
 * 3. Return value is always a finite number
 *
 * Closes #1389
 */
import { assert } from "@std/assert";
import { Activations } from "../../src/methods/activations/Activations.ts";

/**
 * All standard squash function names (non-aggregate, non-deprecated).
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

/** Test raw input values spanning the safe zone, fade zone, and saturated zone. */
const RAW_INPUTS = [
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
  20,
  -20,
  50,
  -50,
  100,
  -100,
];

/** Test error values. */
const ERRORS = [-1, -0.1, 0, 0.1, 1];

/** Test weight values. */
const WEIGHTS = [-1, -0.01, 0, 0.01, 0.5, 1, 10, 100];

// ============================================================================
// Property 1: Return value is always in [0, 1]
// ============================================================================
for (const name of STANDARD_SQUASH_NAMES) {
  Deno.test(`${name}.safeZoneAdjustment: returns value in [0, 1]`, () => {
    const activation = Activations.find(name);
    if (!activation.safeZoneAdjustment) return;

    for (const rawInput of RAW_INPUTS) {
      for (const error of ERRORS) {
        for (const weight of WEIGHTS) {
          const result = activation.safeZoneAdjustment(rawInput, error, weight);
          assert(
            result >= 0 && result <= 1,
            `${name}: safeZoneAdjustment(${rawInput}, ${error}, ${weight}) = ${result}, ` +
              `expected value in [0, 1]`,
          );
        }
      }
    }
  });
}

// ============================================================================
// Property 2: Non-finite raw input returns 0
// ============================================================================
for (const name of STANDARD_SQUASH_NAMES) {
  Deno.test(`${name}.safeZoneAdjustment: non-finite input returns 0`, () => {
    const activation = Activations.find(name);
    if (!activation.safeZoneAdjustment) return;

    const nonFiniteInputs = [NaN, Infinity, -Infinity];
    for (const rawInput of nonFiniteInputs) {
      for (const error of ERRORS) {
        const result = activation.safeZoneAdjustment(rawInput, error, 1);
        assert(
          result === 0,
          `${name}: safeZoneAdjustment(${rawInput}, ${error}, 1) = ${result}, ` +
            `expected 0 for non-finite input`,
        );
      }
    }
  });
}

// ============================================================================
// Property 3: Return value is always finite
// ============================================================================
for (const name of STANDARD_SQUASH_NAMES) {
  Deno.test(`${name}.safeZoneAdjustment: result is always finite`, () => {
    const activation = Activations.find(name);
    if (!activation.safeZoneAdjustment) return;

    for (const rawInput of RAW_INPUTS) {
      for (const error of ERRORS) {
        for (const weight of WEIGHTS) {
          const result = activation.safeZoneAdjustment(rawInput, error, weight);
          assert(
            Number.isFinite(result),
            `${name}: safeZoneAdjustment(${rawInput}, ${error}, ${weight}) = ${result}, ` +
              `expected finite number`,
          );
        }
      }
    }
  });
}
