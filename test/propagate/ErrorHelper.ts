/**
 * Consolidated tests for ErrorHelper.calculateClampedError — verifying
 * clamping, sign preservation, boundary values, and non-finite handling.
 *
 * Merged from ErrorHelper.ts, ErrorHelperBehaviour.ts, ErrorHelperTest.ts
 * as part of Issue #1766 (propagation module test audit).
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { ErrorHelper } from "@propagate/ErrorHelper.ts";

// ---------------------------------------------------------------------------
// Non-finite handling
// ---------------------------------------------------------------------------

Deno.test("calculateClampedError - NaN returns 0", () => {
  assertEquals(ErrorHelper.calculateClampedError(NaN), 0);
});

Deno.test("calculateClampedError - NaN returns 0 regardless of maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(NaN, 50), 0);
  assertEquals(ErrorHelper.calculateClampedError(NaN, 1), 0);
});

Deno.test("calculateClampedError - positive Infinity returns 0", () => {
  assertEquals(ErrorHelper.calculateClampedError(Infinity), 0);
  assertEquals(ErrorHelper.calculateClampedError(Infinity, 50), 0);
});

Deno.test("calculateClampedError - negative Infinity returns 0", () => {
  assertEquals(ErrorHelper.calculateClampedError(-Infinity), 0);
  assertEquals(ErrorHelper.calculateClampedError(-Infinity, 50), 0);
});

// ---------------------------------------------------------------------------
// Pass-through (values within range)
// ---------------------------------------------------------------------------

Deno.test("calculateClampedError - normal values pass through unchanged", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(50), 50, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(-50), -50, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(5), 5, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(-5), -5, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(99.9), 99.9, 1e-12);
});

Deno.test("calculateClampedError - zero error passes through", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(0), 0, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(0, 50), 0, 1e-12);
});

Deno.test("calculateClampedError - very small error passes through", () => {
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(0.001),
    0.001,
    1e-12,
  );
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(-0.001),
    -0.001,
    1e-12,
  );
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(0.000001),
    0.000001,
    1e-12,
  );
});

Deno.test("calculateClampedError - values below custom maxMagnitude pass through", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(5, 10), 5, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(-5, 10), -5, 1e-12);
});

// ---------------------------------------------------------------------------
// Clamping (values exceeding range)
// ---------------------------------------------------------------------------

Deno.test("calculateClampedError - clamps positive overflow to default maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(150), 100);
  assertEquals(ErrorHelper.calculateClampedError(1000), 100);
});

Deno.test("calculateClampedError - clamps negative overflow to negative maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(-150), -100);
  assertEquals(ErrorHelper.calculateClampedError(-1000), -100);
});

Deno.test("calculateClampedError - clamps to custom maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(50, 10), 10);
  assertEquals(ErrorHelper.calculateClampedError(-50, 10), -10);
  assertEquals(ErrorHelper.calculateClampedError(15, 10), 10);
  assertEquals(ErrorHelper.calculateClampedError(-15, 10), -10);
});

Deno.test("calculateClampedError - clamps to small fractional maxMagnitude", () => {
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

Deno.test("calculateClampedError - clamps to large maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(2000, 1000), 1000);
  assertEquals(ErrorHelper.calculateClampedError(-2000, 1000), -1000);
});

// ---------------------------------------------------------------------------
// Boundary values (exactly at maxMagnitude)
// ---------------------------------------------------------------------------

Deno.test("calculateClampedError - exactly at default boundary passes through", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(100), 100, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(-100), -100, 1e-12);
});

Deno.test("calculateClampedError - exactly at custom boundary passes through", () => {
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(10, 10),
    10,
    1e-12,
  );
  assertAlmostEquals(
    ErrorHelper.calculateClampedError(-10, 10),
    -10,
    1e-12,
  );
});

// ---------------------------------------------------------------------------
// Sign preservation
// ---------------------------------------------------------------------------

Deno.test("calculateClampedError - preserves positive sign when clamping", () => {
  const result = ErrorHelper.calculateClampedError(500, 100);
  assertAlmostEquals(result, 100, 1e-12);
});

Deno.test("calculateClampedError - preserves negative sign when clamping", () => {
  const result = ErrorHelper.calculateClampedError(-500, 100);
  assertAlmostEquals(result, -100, 1e-12);
});
