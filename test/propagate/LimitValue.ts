/**
 * Issue #1364: Tests for limitValue() handling of non-finite inputs.
 *
 * The limitValue() function should clamp values to ±1e12 and also handle
 * NaN and Infinity inputs safely rather than letting them pass through.
 */

import { assertEquals } from "@std/assert";
import { limitValue } from "../../src/propagate/BackPropagation.ts";

Deno.test("limitValue - clamps positive values above 1e12", () => {
  assertEquals(limitValue(2e12), 1e12);
  assertEquals(limitValue(1e13), 1e12);
});

Deno.test("limitValue - clamps negative values below -1e12", () => {
  assertEquals(limitValue(-2e12), -1e12);
  assertEquals(limitValue(-1e13), -1e12);
});

Deno.test("limitValue - passes through normal values", () => {
  assertEquals(limitValue(0), 0);
  assertEquals(limitValue(42), 42);
  assertEquals(limitValue(-42), -42);
  assertEquals(limitValue(0.5), 0.5);
  assertEquals(limitValue(1e12), 1e12);
  assertEquals(limitValue(-1e12), -1e12);
});

Deno.test("limitValue - clamps positive Infinity to 1e12", () => {
  assertEquals(limitValue(Infinity), 1e12);
});

Deno.test("limitValue - clamps negative Infinity to -1e12", () => {
  assertEquals(limitValue(-Infinity), -1e12);
});

Deno.test("limitValue - converts NaN to 0", () => {
  assertEquals(limitValue(NaN), 0);
});
