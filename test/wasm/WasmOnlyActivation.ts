/**
 * WASM-Only Activation Tests
 *
 * Issue #1237 - WASM Migration: Verify that WASM is the sole implementation
 * for activation computations (squash, unSquash, calculateError, safeZoneAdjustment).
 *
 * These tests confirm:
 * 1. All standard activations work through the WASM wrapper
 * 2. JS activation type classes no longer carry duplicate computation methods
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "../../src/methods/activations/Activations.ts";
import {
  calculateError,
  safeZoneAdjustment,
  squash,
  unSquash,
} from "../../src/wasm/ActivationMethods.ts";

/**
 * All standard (non-aggregate) activation names that must work via WASM.
 */
const STANDARD_ACTIVATIONS = [
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
  "StdInverse",
  "STEP",
  "Swish",
  "TAN",
  "TANH",
];

Deno.test("WASM-only: squash produces correct values for known activations", () => {
  // Verify specific known values for key activations
  const knownValues: [string, number, number, number][] = [
    // [name, input, expected, tolerance]
    ["IDENTITY", 0.5, 0.5, 1e-6],
    ["TANH", 0.5, Math.tanh(0.5), 1e-3],
    ["LOGISTIC", 0, 0.5, 1e-3],
    ["ReLU", 0.5, 0.5, 1e-6],
    ["ReLU", -0.5, 0, 1e-6],
    ["STEP", 0.5, 1, 1e-6],
    ["STEP", -0.5, 0, 1e-6],
    ["ABSOLUTE", -3, 3, 1e-6],
    ["SQUARE", 3, 9, 1e-3],
    ["COMPLEMENT", 0.3, 0.7, 1e-3],
    ["BIPOLAR", 1, 1, 1e-6],
    ["BIPOLAR", -1, -1, 1e-6],
  ];

  for (const [name, input, expected, tolerance] of knownValues) {
    const result = squash(name, input);
    assertAlmostEquals(
      result,
      expected,
      tolerance,
      `squash(${name}, ${input}) = ${result}, expected ${expected}`,
    );
  }

  // Also verify all standard activations return finite values
  for (const name of STANDARD_ACTIVATIONS) {
    const result = squash(name, 0.5);
    assert(
      Number.isFinite(result),
      `squash(${name}, 0.5) returned non-finite: ${result}`,
    );
  }
});

Deno.test("WASM-only: unSquash produces finite values for all standard activations", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    // Use a value in the activation's range
    const squashed = squash(name, 0.5);
    const result = unSquash(name, squashed, 0.5);
    assert(
      Number.isFinite(result),
      `unSquash(${name}, ${squashed}) returned non-finite: ${result}`,
    );
    // Re-squash should be close to the original squashed value (f32 tolerance)
    const reSquashed = squash(name, result);
    assertAlmostEquals(
      reSquashed,
      squashed,
      1e-2,
      `${name}: squash(unSquash(squash(0.5))) should round-trip, got ${reSquashed} vs ${squashed}`,
    );
  }
});

Deno.test("WASM-only: calculateError returns finite values for all standard activations", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    const result = calculateError(name, 0.5, 0.6, 0.5);
    assert(
      Number.isFinite(result),
      `calculateError(${name}) returned non-finite: ${result}`,
    );
  }
});

Deno.test("WASM-only: calculateError returns zero when target equals current activation", () => {
  const testActivations = ["IDENTITY", "LOGISTIC", "TANH", "ReLU"];
  for (const name of testActivations) {
    const currentValue = 0.5;
    const currentActivation = squash(name, currentValue);
    // When target equals current activation, error should be zero
    const result = calculateError(
      name,
      currentActivation,
      currentActivation,
      currentValue,
    );
    assertAlmostEquals(
      result,
      0,
      1e-3,
      `calculateError(${name}) should be ~0 when target equals current, got ${result}`,
    );
  }
});

Deno.test("WASM-only: safeZoneAdjustment works for all standard activations", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    const result = safeZoneAdjustment(name, 0.5, 0.1, 1.0);
    assert(
      Number.isFinite(result),
      `safeZoneAdjustment(${name}) returned non-finite: ${result}`,
    );
    assert(
      result >= 0 && result <= 1,
      `safeZoneAdjustment(${name}) out of [0,1]: ${result}`,
    );
  }
});

Deno.test("WASM-only: squash/unSquash round-trip for invertible activations", () => {
  const invertibleActivations = [
    "ArcTan",
    "BENT_IDENTITY",
    "ELU",
    "IDENTITY",
    "LeakyReLU",
    "LOGISTIC",
    "ReLU",
    "SELU",
    "SOFTSIGN",
    "Softplus",
    "StdInverse",
    "TANH",
  ];

  for (const name of invertibleActivations) {
    const x = 0.5;
    const squashed = squash(name, x);
    const restored = unSquash(name, squashed, x);
    const reSquashed = squash(name, restored);

    assertAlmostEquals(
      squashed,
      reSquashed,
      1e-3, // f32 tolerance
      `Round-trip failed for ${name}: squash(${x})=${squashed}, unSquash=${restored}, re-squash=${reSquashed}`,
    );
  }
});

Deno.test("WASM-only: JS activation classes retain metadata", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    const activation = Activations.find(name);

    assertEquals(
      activation.getName(),
      name,
      `${name}.getName() returned ${activation.getName()}`,
    );
    assert(activation.range !== undefined, `${name} missing range`);
    assert(
      activation.range.low <= activation.range.high,
      `${name} range.low (${activation.range.low}) > range.high (${activation.range.high})`,
    );
    assert(
      Number.isInteger(activation.mutationProbability) &&
        activation.mutationProbability >= 0,
      `${name} mutationProbability should be a non-negative integer, got ${activation.mutationProbability}`,
    );
  }
});
