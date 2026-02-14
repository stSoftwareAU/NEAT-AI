/**
 * Behavioural tests for ErrorHelper.ts — verifying error clamping,
 * sign preservation, and non-finite value handling.
 *
 * These are "what" tests: they exercise real functions with test data
 * and check outcomes, not implementation details.
 *
 * Closes #1440
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import { ErrorHelper } from "../../src/propagate/ErrorHelper.ts";

// ---------------------------------------------------------------------------
// Sign preservation
// ---------------------------------------------------------------------------

Deno.test("ErrorHelper - preserves positive sign when clamping", () => {
  const result = ErrorHelper.calculateClampedError(500, 100);
  assertGreater(result, 0, "Positive error should remain positive");
  assertAlmostEquals(result, 100, 1e-12);
});

Deno.test("ErrorHelper - preserves negative sign when clamping", () => {
  const result = ErrorHelper.calculateClampedError(-500, 100);
  assertLess(result, 0, "Negative error should remain negative");
  assertAlmostEquals(result, -100, 1e-12);
});

// ---------------------------------------------------------------------------
// Various maxMagnitude values
// ---------------------------------------------------------------------------

Deno.test("ErrorHelper - clamps to custom small maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(5, 1), 1);
  assertEquals(ErrorHelper.calculateClampedError(-5, 1), -1);
});

Deno.test("ErrorHelper - clamps to custom large maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(2000, 1000), 1000);
  assertEquals(ErrorHelper.calculateClampedError(-2000, 1000), -1000);
});

Deno.test("ErrorHelper - passes through values below maxMagnitude", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(5, 10), 5, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(-5, 10), -5, 1e-12);
});

// ---------------------------------------------------------------------------
// Non-finite handling
// ---------------------------------------------------------------------------

Deno.test("ErrorHelper - NaN returns 0 regardless of maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(NaN, 50), 0);
  assertEquals(ErrorHelper.calculateClampedError(NaN, 1), 0);
});

Deno.test("ErrorHelper - positive Infinity returns 0", () => {
  assertEquals(ErrorHelper.calculateClampedError(Infinity, 50), 0);
});

Deno.test("ErrorHelper - negative Infinity returns 0", () => {
  assertEquals(ErrorHelper.calculateClampedError(-Infinity, 50), 0);
});

// ---------------------------------------------------------------------------
// Zero error
// ---------------------------------------------------------------------------

Deno.test("ErrorHelper - zero error passes through", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(0), 0, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(0, 50), 0, 1e-12);
});

// ---------------------------------------------------------------------------
// Fractional errors
// ---------------------------------------------------------------------------

Deno.test("ErrorHelper - very small error passes through", () => {
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(0.000001),
    0.000001,
    1e-12,
  );
});

Deno.test("ErrorHelper - fractional maxMagnitude works correctly", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(0.5, 0.1), 0.1, 1e-12);
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(-0.5, 0.1),
    -0.1,
    1e-12,
  );
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(0.05, 0.1),
    0.05,
    1e-12,
  );
});
