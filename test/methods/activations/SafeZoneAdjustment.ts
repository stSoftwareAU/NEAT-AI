/**
 * Unit tests for activation function safeZoneAdjustment() implementations.
 *
 * These tests verify that safe-zone factors behave correctly:
 * - Return values are always in [0, 1]
 * - Return 0 for non-finite inputs
 * - Return high values (near 1) in the linear/active region
 * - Return low values (near 0) in saturation regions
 * - Recovery logic allows small values when error direction would help
 *
 * @module
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { AbstractActivationInterface } from "../../../src/methods/activations/AbstractActivationInterface.ts";

function hasSafeZone(
  activation: AbstractActivationInterface,
): activation is AbstractActivationInterface & {
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number;
} {
  return typeof activation.safeZoneAdjustment === "function";
}

// --- Specific safe-zone boundary tests for key activations ---

Deno.test("ArcTan: full confidence in linear zone [-2, 2]", () => {
  const activation = Activations.find("ArcTan");
  assert(hasSafeZone(activation), "ArcTan must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(1, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-2, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(2, -0.1, 1), 1);
});

Deno.test("ArcTan: zero confidence beyond saturation zone (|x| > 4)", () => {
  const activation = Activations.find("ArcTan");
  assert(hasSafeZone(activation), "ArcTan must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(5, 0.1, 1), 0);
  assertEquals(activation.safeZoneAdjustment(-5, -0.1, 1), 0);
});

Deno.test("ArcTan: recovery zone allows small values", () => {
  const activation = Activations.find("ArcTan");
  assert(hasSafeZone(activation), "ArcTan must have safeZoneAdjustment");

  // rawInput > 2 and error < 0 (pushing toward centre)
  assertAlmostEquals(activation.safeZoneAdjustment(3, -0.1, 1), 0.3, 0.01);
  // rawInput < -2 and error > 0 (pushing toward centre)
  assertAlmostEquals(activation.safeZoneAdjustment(-3, 0.1, 1), 0.3, 0.01);
});

Deno.test("LOGISTIC: full confidence in safe zone [-6, 6]", () => {
  const activation = Activations.find("LOGISTIC");
  assert(hasSafeZone(activation), "LOGISTIC must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(5, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-6, 0.1, 1), 1);
});

Deno.test("LOGISTIC: zero confidence beyond hard saturation", () => {
  const activation = Activations.find("LOGISTIC");
  assert(hasSafeZone(activation), "LOGISTIC must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(11, 0.1, 1), 0);
  assertEquals(activation.safeZoneAdjustment(-11, -0.1, 1), 0);
});

Deno.test("LOGISTIC: recovery allows small propagation", () => {
  const activation = Activations.find("LOGISTIC");
  assert(hasSafeZone(activation), "LOGISTIC must have safeZoneAdjustment");

  // rawInput < -6 and error > 0 → recovery
  assertAlmostEquals(activation.safeZoneAdjustment(-8, 0.1, 1), 0.2, 0.01);
  // rawInput > 6 and error < 0 → recovery
  assertAlmostEquals(activation.safeZoneAdjustment(8, -0.1, 1), 0.2, 0.01);
});

Deno.test("TANH: full confidence in safe zone [-2, 2]", () => {
  const activation = Activations.find("TANH");
  assert(hasSafeZone(activation), "TANH must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(1.5, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-2, 0.1, 1), 1);
});

Deno.test("TANH: zero confidence beyond saturation", () => {
  const activation = Activations.find("TANH");
  assert(hasSafeZone(activation), "TANH must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(7, 0.1, 1), 0);
  assertEquals(activation.safeZoneAdjustment(-7, -0.1, 1), 0);
});

Deno.test("TANH: fade zone between safe and saturation", () => {
  const activation = Activations.find("TANH");
  assert(hasSafeZone(activation), "TANH must have safeZoneAdjustment");

  // rawInput = 4, between safe (2) and max (6)
  // fade = 1 - (4 - 2) / (6 - 2) = 0.5
  const result = activation.safeZoneAdjustment(4, 0.1, 1);
  assertAlmostEquals(result, 0.5, 0.01);
});

Deno.test("HARD_TANH: full confidence in linear zone [-0.9, 0.9]", () => {
  const activation = Activations.find("HARD_TANH");
  assert(hasSafeZone(activation), "HARD_TANH must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(0.5, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-0.9, 0.1, 1), 1);
});

Deno.test("HARD_TANH: zero confidence far outside clipping zone", () => {
  const activation = Activations.find("HARD_TANH");
  assert(hasSafeZone(activation), "HARD_TANH must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(2, 0.1, 1), 0);
  assertEquals(activation.safeZoneAdjustment(-2, -0.1, 1), 0);
});

Deno.test("ReLU: full confidence when active (x > 0)", () => {
  const activation = Activations.find("ReLU");
  assert(hasSafeZone(activation), "ReLU must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(1, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(100, 0.1, 1), 1);
});

Deno.test("ReLU: dead zone when x <= 0 and error <= 0", () => {
  const activation = Activations.find("ReLU");
  assert(hasSafeZone(activation), "ReLU must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(-1, -0.1, 1), 0);
  assertEquals(activation.safeZoneAdjustment(0, -0.1, 1), 0);
});

Deno.test("ReLU: recovery when x <= 0 and error > 0", () => {
  const activation = Activations.find("ReLU");
  assert(hasSafeZone(activation), "ReLU must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(-1, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
});

Deno.test("ReLU6: full confidence in active zone (0, 6)", () => {
  const activation = Activations.find("ReLU6");
  assert(hasSafeZone(activation), "ReLU6 must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(3, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(0.1, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(5.9, 0.1, 1), 1);
});

Deno.test("ReLU6: dead zones at both ends", () => {
  const activation = Activations.find("ReLU6");
  assert(hasSafeZone(activation), "ReLU6 must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(-1, -0.1, 1), 0);
  assertEquals(activation.safeZoneAdjustment(7, 0.1, 1), 0);
});

Deno.test("ReLU6: recovery from saturation", () => {
  const activation = Activations.find("ReLU6");
  assert(hasSafeZone(activation), "ReLU6 must have safeZoneAdjustment");

  // x <= 0 with positive error → recovery
  assertEquals(activation.safeZoneAdjustment(-1, 0.1, 1), 1);
  // x >= 6 with negative error → recovery
  assertEquals(activation.safeZoneAdjustment(7, -0.1, 1), 1);
});

Deno.test("GAUSSIAN: full confidence near zero [-3, 3]", () => {
  const activation = Activations.find("GAUSSIAN");
  assert(hasSafeZone(activation), "GAUSSIAN must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(2, 0.1, 1), 1);
});

Deno.test("GAUSSIAN: zero confidence far from zero with worsening error", () => {
  const activation = Activations.find("GAUSSIAN");
  assert(hasSafeZone(activation), "GAUSSIAN must have safeZoneAdjustment");

  // Raw > 3 and error > 0 → getting worse
  assertEquals(activation.safeZoneAdjustment(5, 0.1, 1), 0);
  // Raw < -3 and error < 0 → getting worse
  assertEquals(activation.safeZoneAdjustment(-5, -0.1, 1), 0);
});

Deno.test("IDENTITY: full confidence for normal inputs", () => {
  const activation = Activations.find("IDENTITY");
  assert(hasSafeZone(activation), "IDENTITY must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(100, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-100, -0.1, 1), 1);
});

Deno.test("IDENTITY: zero confidence for extreme input with tiny weight", () => {
  const activation = Activations.find("IDENTITY");
  assert(hasSafeZone(activation), "IDENTITY must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(2e6, 0.1, 1e-7), 0);
  assertEquals(activation.safeZoneAdjustment(-2e6, -0.1, 1e-7), 0);
});

Deno.test("STEP: high confidence when on wrong side of threshold", () => {
  const activation = Activations.find("STEP");
  assert(hasSafeZone(activation), "STEP must have safeZoneAdjustment");

  // isAbove = true (rawInput > 0), expectedAbove = false (error < 0) → wrong side
  assertEquals(activation.safeZoneAdjustment(1, -0.1, 1), 1);
  // isAbove = false, expectedAbove = true → wrong side
  assertEquals(activation.safeZoneAdjustment(-1, 0.1, 1), 1);
});

Deno.test("STEP: reduced confidence when on correct side", () => {
  const activation = Activations.find("STEP");
  assert(hasSafeZone(activation), "STEP must have safeZoneAdjustment");

  assertAlmostEquals(activation.safeZoneAdjustment(1, 0.1, 1), 0.2, 0.01);
  assertAlmostEquals(activation.safeZoneAdjustment(-1, -0.1, 1), 0.2, 0.01);
});

Deno.test("ABSOLUTE: full confidence for most inputs", () => {
  const activation = Activations.find("ABSOLUTE");
  assert(hasSafeZone(activation), "ABSOLUTE must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(5, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-5, 0.1, 1), 1);
});

Deno.test("ABSOLUTE: full confidence for near-zero inputs", () => {
  const activation = Activations.find("ABSOLUTE");
  assert(hasSafeZone(activation), "ABSOLUTE must have safeZoneAdjustment");

  // Near-zero inputs should still have full confidence — the sign ambiguity
  // at zero does not warrant suppressing the gradient signal.
  assertEquals(activation.safeZoneAdjustment(0.5, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-0.5, -0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(0.01, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
});

Deno.test("ABSOLUTE: zero for extreme input with tiny weight", () => {
  const activation = Activations.find("ABSOLUTE");
  assert(hasSafeZone(activation), "ABSOLUTE must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(2000, 0.1, 1e-4), 0);
});

Deno.test("Cosine: high confidence where slope is strong", () => {
  const activation = Activations.find("Cosine");
  assert(hasSafeZone(activation), "Cosine must have safeZoneAdjustment");

  // At x = π/2, sin(x) = 1 → strong slope
  const result = activation.safeZoneAdjustment(Math.PI / 2, 0.1, 1);
  assertEquals(result, 1);
});

Deno.test("Cosine: zero confidence at flat peaks", () => {
  const activation = Activations.find("Cosine");
  assert(hasSafeZone(activation), "Cosine must have safeZoneAdjustment");

  // At x = 0, sin(0) = 0 → flat
  const result = activation.safeZoneAdjustment(0, 0.1, 1);
  assertEquals(result, 0);
});

Deno.test("SINE: high confidence where cos is strong", () => {
  const activation = Activations.find("SINE");
  assert(hasSafeZone(activation), "SINE must have safeZoneAdjustment");

  // At x = 0, cos(0) = 1 → strong slope
  const result = activation.safeZoneAdjustment(0, 0.1, 1);
  assertEquals(result, 1);
});

Deno.test("Exponential: full confidence in safe zone [-10, 30]", () => {
  const activation = Activations.find("Exponential");
  assert(hasSafeZone(activation), "Exponential must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(20, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-5, 0.1, 1), 1);
});

Deno.test("Exponential: zero when far outside safe zone and worsening", () => {
  const activation = Activations.find("Exponential");
  assert(hasSafeZone(activation), "Exponential must have safeZoneAdjustment");

  // rawInput > 30 and error > 0 → worsening
  assertEquals(activation.safeZoneAdjustment(50, 0.1, 1), 0);
  // rawInput < -10 and error < 0 → worsening
  assertEquals(activation.safeZoneAdjustment(-30, -0.1, 1), 0);
});

Deno.test("SQUARE: full confidence in [-5, 5]", () => {
  const activation = Activations.find("SQUARE");
  assert(hasSafeZone(activation), "SQUARE must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(0, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(3, 0.1, 1), 1);
  assertEquals(activation.safeZoneAdjustment(-5, 0.1, 1), 1);
});

Deno.test("SQUARE: fade zone between 5 and 10", () => {
  const activation = Activations.find("SQUARE");
  assert(hasSafeZone(activation), "SQUARE must have safeZoneAdjustment");

  // rawInput = 7.5, fade = 1 - (7.5 - 5) / 5 = 0.5
  const result = activation.safeZoneAdjustment(7.5, 0.1, 1);
  assertAlmostEquals(result, 0.5, 0.01);
});

Deno.test("SQUARE: zero confidence beyond 10", () => {
  const activation = Activations.find("SQUARE");
  assert(hasSafeZone(activation), "SQUARE must have safeZoneAdjustment");

  assertEquals(activation.safeZoneAdjustment(11, 0.1, 1), 0);
});

Deno.test("SQUARE: recovery zone allows small value", () => {
  const activation = Activations.find("SQUARE");
  assert(hasSafeZone(activation), "SQUARE must have safeZoneAdjustment");

  // rawInput > 5 and error < 0 → recovery
  assertAlmostEquals(activation.safeZoneAdjustment(6, -0.1, 1), 0.2, 0.01);
  // rawInput < -5 and error > 0 → recovery
  assertAlmostEquals(activation.safeZoneAdjustment(-6, 0.1, 1), 0.2, 0.01);
});
