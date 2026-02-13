/**
 * Unit tests for ErrorHelper.ts - calculateClampedError.
 *
 * Closes #1399
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { ErrorHelper } from "../../src/propagate/ErrorHelper.ts";

// ---------------------------------------------------------------------------
// calculateClampedError
// ---------------------------------------------------------------------------

Deno.test("ErrorHelper.calculateClampedError - passes through normal values", () => {
  assertAlmostEquals(ErrorHelper.calculateClampedError(5), 5, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(-5), -5, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(0), 0, 1e-12);
});

Deno.test("ErrorHelper.calculateClampedError - clamps to default maxMagnitude 100", () => {
  assertEquals(ErrorHelper.calculateClampedError(150), 100);
  assertEquals(ErrorHelper.calculateClampedError(-150), -100);
});

Deno.test("ErrorHelper.calculateClampedError - clamps to custom maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(50, 10), 10);
  assertEquals(ErrorHelper.calculateClampedError(-50, 10), -10);
});

Deno.test("ErrorHelper.calculateClampedError - returns 0 for NaN", () => {
  assertEquals(ErrorHelper.calculateClampedError(NaN), 0);
});

Deno.test("ErrorHelper.calculateClampedError - returns 0 for positive Infinity", () => {
  assertEquals(ErrorHelper.calculateClampedError(Infinity), 0);
});

Deno.test("ErrorHelper.calculateClampedError - returns 0 for negative Infinity", () => {
  assertEquals(ErrorHelper.calculateClampedError(-Infinity), 0);
});

Deno.test("ErrorHelper.calculateClampedError - boundary: exactly maxMagnitude", () => {
  // Exactly at the boundary should pass through (not clamped)
  assertAlmostEquals(ErrorHelper.calculateClampedError(100), 100, 1e-12);
  assertAlmostEquals(ErrorHelper.calculateClampedError(-100), -100, 1e-12);
});

Deno.test("ErrorHelper.calculateClampedError - small errors pass through", () => {
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
});

Deno.test("ErrorHelper.calculateClampedError - custom maxMagnitude boundary", () => {
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
