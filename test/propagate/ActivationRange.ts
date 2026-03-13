import { assertEquals, assertThrows } from "@std/assert";
import { ActivationRange } from "../../src/propagate/ActivationRange.ts";

Deno.test("ActivationRange constructor - valid range", () => {
  const range = new ActivationRange("test", -1, 1);
  assertEquals(range.low, -1);
  assertEquals(range.high, 1);
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

Deno.test("ActivationRange validate - accepts value within range", () => {
  const range = new ActivationRange("test", -1, 1);
  // Should not throw
  range.validate(0);
  range.validate(-1);
  range.validate(1);
  range.validate(0.5);
});

Deno.test("ActivationRange validate - rejects value below range", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(() => range.validate(-1.5));
});

Deno.test("ActivationRange validate - rejects value above range", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(() => range.validate(1.5));
});

Deno.test("ActivationRange validate - rejects NaN", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(() => range.validate(NaN));
});

Deno.test("ActivationRange validate - rejects Infinity", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(() => range.validate(Infinity));
  assertThrows(() => range.validate(-Infinity));
});

Deno.test("ActivationRange validate - includes hint in error message", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(
    () => range.validate(5, 42),
    Error,
    "hint",
  );
});

Deno.test("ActivationRange limit - clamps to high on Infinity", () => {
  const range = new ActivationRange("test", -1, 1);
  assertEquals(range.limit(Infinity), 1);
});

Deno.test("ActivationRange limit - clamps to low on -Infinity", () => {
  const range = new ActivationRange("test", -1, 1);
  assertEquals(range.limit(-Infinity), -1);
});

Deno.test("ActivationRange limit - throws on NaN", () => {
  const range = new ActivationRange("test", -1, 1);
  assertThrows(() => range.limit(NaN));
});

Deno.test("ActivationRange limit - clamps value above high", () => {
  const range = new ActivationRange("test", -1, 1);
  assertEquals(range.limit(5), 1);
});

Deno.test("ActivationRange limit - clamps value below low", () => {
  const range = new ActivationRange("test", -1, 1);
  assertEquals(range.limit(-5), -1);
});

Deno.test("ActivationRange limit - passes through value in range", () => {
  const range = new ActivationRange("test", -1, 1);
  assertEquals(range.limit(0.5), 0.5);
  assertEquals(range.limit(0), 0);
  assertEquals(range.limit(-0.75), -0.75);
});

Deno.test("ActivationRange limit - boundary values pass through", () => {
  const range = new ActivationRange("test", -1, 1);
  assertEquals(range.limit(-1), -1);
  assertEquals(range.limit(1), 1);
});

Deno.test("ActivationRange - asymmetric range [0, 6]", () => {
  const range = new ActivationRange("ReLU6", 0, 6);
  assertEquals(range.limit(-5), 0);
  assertEquals(range.limit(10), 6);
  assertEquals(range.limit(3), 3);
  range.validate(0);
  range.validate(6);
  assertThrows(() => range.validate(-0.1));
});
