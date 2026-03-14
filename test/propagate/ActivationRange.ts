/**
 * Consolidated tests for ActivationRange — verifying range creation,
 * validation, and clamping behaviour across different range configurations.
 *
 * Merged from ActivationRange.ts and ActivationRangeBehaviour.ts
 * as part of Issue #1766 (propagation module test audit).
 */
import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { ActivationRange } from "../../src/propagate/ActivationRange.ts";

// ---------------------------------------------------------------------------
// Constructor - range creation
// ---------------------------------------------------------------------------

Deno.test("ActivationRange constructor - stores low and high bounds", () => {
  const range = new ActivationRange("test", -1, 1);
  assertAlmostEquals(range.low, -1, 1e-12);
  assertAlmostEquals(range.high, 1, 1e-12);
});

Deno.test("ActivationRange constructor - rejects low >= high", () => {
  assertThrows(
    () => new ActivationRange("bad", 1, 1),
    Error,
    "low must be less than high",
  );
  assertThrows(
    () => new ActivationRange("bad", 5, 3),
    Error,
    "low must be less than high",
  );
});

Deno.test("ActivationRange constructor - rejects out-of-safe-integer bounds", () => {
  assertThrows(
    () => new ActivationRange("bad", Number.MIN_SAFE_INTEGER - 1, 1),
    Error,
  );
  assertThrows(
    () => new ActivationRange("bad", -1, Number.MAX_SAFE_INTEGER + 1),
    Error,
  );
});

Deno.test("ActivationRange constructor - supports wide ranges", () => {
  const range = new ActivationRange("wide", -1e10, 1e10);
  assertAlmostEquals(range.low, -1e10, 1);
  assertAlmostEquals(range.high, 1e10, 1);
});

// ---------------------------------------------------------------------------
// validate - activation boundary checking
// ---------------------------------------------------------------------------

Deno.test("ActivationRange validate - accepts value within range", () => {
  const range = new ActivationRange("test", -1, 1);
  range.validate(0);
  range.validate(0.5);
  range.validate(-0.5);
  range.validate(1);
  range.validate(-1);
});

Deno.test("ActivationRange validate - accepts exact boundary values", () => {
  const range = new ActivationRange("test", 0, 10);
  range.validate(0);
  range.validate(10);
});

Deno.test("ActivationRange validate - rejects value above range", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(
    () => range.validate(1.1),
    Error,
    "outside the valid range",
  );
});

Deno.test("ActivationRange validate - rejects value below range", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(
    () => range.validate(-1.1),
    Error,
    "outside the valid range",
  );
});

Deno.test("ActivationRange validate - rejects NaN", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(
    () => range.validate(NaN),
    Error,
    "outside the valid range",
  );
});

Deno.test("ActivationRange validate - rejects Infinity", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(
    () => range.validate(Infinity),
    Error,
    "outside the valid range",
  );
});

Deno.test("ActivationRange validate - rejects -Infinity", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(
    () => range.validate(-Infinity),
    Error,
    "outside the valid range",
  );
});

Deno.test("ActivationRange validate - includes hint and name in error message", () => {
  const range = new ActivationRange("testSquash", -1, 1);
  try {
    range.validate(2.0, 0.5);
    throw new Error("Should have thrown");
  } catch (e) {
    const msg = (e as Error).message;
    assertEquals(
      msg.includes("hint"),
      true,
      "Error message should include hint",
    );
    assertEquals(
      msg.includes("testSquash"),
      true,
      "Error message should include name",
    );
  }
});

// ---------------------------------------------------------------------------
// limit - clamps activation to range
// ---------------------------------------------------------------------------

Deno.test("ActivationRange limit - passes through values within range", () => {
  const range = new ActivationRange("test", -1, 1);
  assertAlmostEquals(range.limit(0.5), 0.5, 1e-12);
  assertAlmostEquals(range.limit(-0.5), -0.5, 1e-12);
  assertAlmostEquals(range.limit(0), 0, 1e-12);
  assertAlmostEquals(range.limit(-0.75), -0.75, 1e-12);
});

Deno.test("ActivationRange limit - clamps values above range to high", () => {
  const range = new ActivationRange("test", -1, 1);
  assertAlmostEquals(range.limit(5.0), 1.0, 1e-12);
  assertAlmostEquals(range.limit(100.0), 1.0, 1e-12);
});

Deno.test("ActivationRange limit - clamps values below range to low", () => {
  const range = new ActivationRange("test", -1, 1);
  assertAlmostEquals(range.limit(-5.0), -1.0, 1e-12);
  assertAlmostEquals(range.limit(-100.0), -1.0, 1e-12);
});

Deno.test("ActivationRange limit - clamps positive Infinity to high", () => {
  const range = new ActivationRange("test", -1, 1);
  assertAlmostEquals(range.limit(Infinity), 1.0, 1e-12);
});

Deno.test("ActivationRange limit - clamps negative Infinity to low", () => {
  const range = new ActivationRange("test", -1, 1);
  assertAlmostEquals(range.limit(-Infinity), -1.0, 1e-12);
});

Deno.test("ActivationRange limit - throws for NaN", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(
    () => range.limit(NaN),
    Error,
    "not finite",
  );
});

Deno.test("ActivationRange limit - preserves boundary values exactly", () => {
  const range = new ActivationRange("test", -1, 1);
  assertAlmostEquals(range.limit(-1), -1, 1e-12);
  assertAlmostEquals(range.limit(1), 1, 1e-12);
});

// ---------------------------------------------------------------------------
// Squash-specific range configurations
// ---------------------------------------------------------------------------

Deno.test("ActivationRange - asymmetric range [0, 6] clamps correctly", () => {
  const range = new ActivationRange("ReLU6", 0, 6);
  assertAlmostEquals(range.limit(-5), 0, 1e-12);
  assertAlmostEquals(range.limit(10), 6, 1e-12);
  assertAlmostEquals(range.limit(3), 3, 1e-12);
  range.validate(0);
  range.validate(6);
  assertThrows(() => range.validate(-0.1));
});

Deno.test("ActivationRange - ReLU-like range [0, large] clamps negative to zero", () => {
  const range = new ActivationRange("ReLU", 0, 1e15);
  assertAlmostEquals(range.limit(-0.5), 0, 1e-12);
  assertAlmostEquals(range.limit(0.5), 0.5, 1e-12);
});

Deno.test("ActivationRange - sigmoid-like range [0, 1] clamps both sides", () => {
  const range = new ActivationRange("LOGISTIC", 0, 1);
  assertAlmostEquals(range.limit(-0.5), 0, 1e-12);
  assertAlmostEquals(range.limit(1.5), 1.0, 1e-12);
  assertAlmostEquals(range.limit(0.5), 0.5, 1e-12);
});

Deno.test("ActivationRange - tanh-like range [-1, 1] clamps both sides", () => {
  const range = new ActivationRange("TANH", -1, 1);
  assertAlmostEquals(range.limit(-1.5), -1, 1e-12);
  assertAlmostEquals(range.limit(1.5), 1, 1e-12);
  assertAlmostEquals(range.limit(0), 0, 1e-12);
});
