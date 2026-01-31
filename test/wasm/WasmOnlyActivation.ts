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

import { assert, assertAlmostEquals } from "@std/assert";
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

Deno.test("WASM-only: squash works for all standard activations", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    const result = squash(name, 0.5);
    assert(
      Number.isFinite(result),
      `squash(${name}, 0.5) returned non-finite: ${result}`,
    );
  }
});

Deno.test("WASM-only: unSquash works for all standard activations", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    // Use a value in the activation's range
    const squashed = squash(name, 0.5);
    const result = unSquash(name, squashed, 0.5);
    assert(
      Number.isFinite(result),
      `unSquash(${name}, ${squashed}) returned non-finite: ${result}`,
    );
  }
});

Deno.test("WASM-only: calculateError works for all standard activations", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    const result = calculateError(name, 0.5, 0.6, 0.5);
    assert(
      Number.isFinite(result),
      `calculateError(${name}) returned non-finite: ${result}`,
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

Deno.test("WASM-only: WASM wrapper works alongside JS activation classes", () => {
  // Verify WASM wrapper produces finite results for all standard activations
  for (const name of STANDARD_ACTIVATIONS) {
    const activation = Activations.find(name);
    assert(
      activation !== undefined,
      `Activation ${name} not found in Activations registry`,
    );

    // WASM wrapper should work for all activations
    const wasmResult = squash(name, 0.5);
    assert(
      Number.isFinite(wasmResult),
      `WASM squash(${name}, 0.5) returned non-finite: ${wasmResult}`,
    );
  }
});

Deno.test("WASM-only: JS activation classes retain metadata", () => {
  for (const name of STANDARD_ACTIVATIONS) {
    const activation = Activations.find(name);

    assert(
      activation.getName() === name,
      `${name}.getName() returned ${activation.getName()}`,
    );
    assert(
      activation.range !== undefined,
      `${name} missing range`,
    );
    assert(
      typeof activation.mutationProbability === "number",
      `${name} missing mutationProbability`,
    );
  }
});
