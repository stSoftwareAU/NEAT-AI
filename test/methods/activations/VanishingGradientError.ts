/**
 * Tests for stable error calculation in activations with vanishing gradients.
 *
 * When the derivative is near zero (e.g., large negative inputs for Mish/Swish),
 * dividing rawError by a tiny slope produces extreme or zero results:
 * - slope ≈ 0 but non-zero → rawError/slope → clamped to ±100
 * - slope = 0 exactly → rawError/0 → Infinity → ErrorHelper returns 0
 *
 * The fix is to fall back to unSquash when the slope is too small, producing
 * a moderate, directionally correct error signal.
 *
 * Fixes #1588
 *
 * @module
 */

import { assert } from "@std/assert";
import { Mish } from "@methods/activations/types/Mish.ts";
import { Swish } from "@methods/activations/types/Swish.ts";
import { GELU } from "@methods/activations/types/GELU.ts";
import { ELU } from "@methods/activations/types/ELU.ts";
import { SELU } from "@methods/activations/types/SELU.ts";

/**
 * Helper: asserts error is finite, non-zero, and not at the clamp limit.
 */
function assertReasonableError(error: number, label: string) {
  assert(
    Number.isFinite(error),
    `${label}: error should be finite, got ${error}`,
  );
  assert(error !== 0, `${label}: error should be non-zero`);
  assert(
    Math.abs(error) < 90,
    `${label}: error should not be clamped to extreme, got ${error}`,
  );
}

// --- Mish vanishing gradient tests ---

Deno.test("Mish: calculateError uses fallback at x = -10 (zero derivative)", () => {
  const mish = new Mish();
  const currentValue = -10;
  const currentActivation = mish.squash(currentValue);
  // Use a target that's substantially different from the near-zero activation
  const targetActivation = 0.5;

  const error = mish.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "Mish x=-10");
  assert(error > 0, `Mish x=-10: error should be positive, got ${error}`);
});

Deno.test("Mish: calculateError uses fallback at x = -20 (zero derivative)", () => {
  const mish = new Mish();
  const currentValue = -20;
  const currentActivation = mish.squash(currentValue);
  const targetActivation = 1.0;

  const error = mish.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "Mish x=-20");
  assert(error > 0, `Mish x=-20: error should be positive, got ${error}`);
});

// --- Swish vanishing gradient tests ---

Deno.test("Swish: calculateError uses fallback at x = -10 (vanishing derivative)", () => {
  const swish = new Swish();
  const currentValue = -10;
  const currentActivation = swish.squash(currentValue);
  const targetActivation = 0.5;

  const error = swish.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "Swish x=-10");
  assert(error > 0, `Swish x=-10: error should be positive, got ${error}`);
});

Deno.test("Swish: calculateError uses fallback at x = -20 (vanishing derivative)", () => {
  const swish = new Swish();
  const currentValue = -20;
  const currentActivation = swish.squash(currentValue);
  const targetActivation = 1.0;

  const error = swish.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "Swish x=-20");
  assert(error > 0, `Swish x=-20: error should be positive, got ${error}`);
});

// --- GELU vanishing gradient tests ---

Deno.test("GELU: calculateError uses fallback at x = -5 (vanishing derivative)", () => {
  const gelu = new GELU();
  const currentValue = -5;
  const currentActivation = gelu.squash(currentValue);
  const targetActivation = 0.5;

  const error = gelu.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "GELU x=-5");
  assert(error > 0, `GELU x=-5: error should be positive, got ${error}`);
});

Deno.test("GELU: calculateError uses fallback at x = -10 (zero derivative)", () => {
  const gelu = new GELU();
  const currentValue = -10;
  const currentActivation = gelu.squash(currentValue);
  const targetActivation = 1.0;

  const error = gelu.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "GELU x=-10");
  assert(error > 0, `GELU x=-10: error should be positive, got ${error}`);
});

// --- ELU vanishing gradient tests ---

Deno.test("ELU: calculateError uses fallback at x = -50 (zero derivative)", () => {
  const elu = new ELU();
  const currentValue = -50;
  const currentActivation = elu.squash(currentValue);
  const targetActivation = 0.5;

  const error = elu.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "ELU x=-50");
  assert(error > 0, `ELU x=-50: error should be positive, got ${error}`);
});

// --- SELU vanishing gradient tests ---

Deno.test("SELU: calculateError uses fallback at x = -50 (near-zero derivative)", () => {
  const selu = new SELU();
  const currentValue = -50;
  const currentActivation = selu.squash(currentValue);
  const targetActivation = 0.5;

  const error = selu.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assertReasonableError(error, "SELU x=-50");
  assert(error > 0, `SELU x=-50: error should be positive, got ${error}`);
});

// --- Normal-region regression tests ---

Deno.test("Mish: calculateError still works in normal region", () => {
  const mish = new Mish();
  const currentValue = 1;
  const currentActivation = mish.squash(currentValue);
  const targetActivation = mish.squash(2);

  const error = mish.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assert(Number.isFinite(error), `Error should be finite, got ${error}`);
  assert(
    error > 0,
    `Error should be positive (pushing value up), got ${error}`,
  );
});

Deno.test("Swish: calculateError still works in normal region", () => {
  const swish = new Swish();
  const currentValue = 1;
  const currentActivation = swish.squash(currentValue);
  const targetActivation = swish.squash(2);

  const error = swish.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assert(Number.isFinite(error), `Error should be finite, got ${error}`);
  assert(error > 0, `Error should be positive, got ${error}`);
});

Deno.test("GELU: calculateError still works in normal region", () => {
  const gelu = new GELU();
  const currentValue = 1;
  const currentActivation = gelu.squash(currentValue);
  const targetActivation = gelu.squash(2);

  const error = gelu.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assert(Number.isFinite(error), `Error should be finite, got ${error}`);
  assert(error > 0, `Error should be positive, got ${error}`);
});

Deno.test("ELU: calculateError still works in normal region", () => {
  const elu = new ELU();
  const currentValue = 1;
  const currentActivation = elu.squash(currentValue);
  const targetActivation = elu.squash(2);

  const error = elu.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assert(Number.isFinite(error), `Error should be finite, got ${error}`);
  assert(error > 0, `Error should be positive, got ${error}`);
});

Deno.test("SELU: calculateError still works in normal region", () => {
  const selu = new SELU();
  const currentValue = 1;
  const currentActivation = selu.squash(currentValue);
  const targetActivation = selu.squash(2);

  const error = selu.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  assert(Number.isFinite(error), `Error should be finite, got ${error}`);
  assert(error > 0, `Error should be positive, got ${error}`);
});
