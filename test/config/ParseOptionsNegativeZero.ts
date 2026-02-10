/**
 * Issue #1368: Tests for negative zero normalisation in parseNumber()
 * and parseDiscoverySampleRate().
 *
 * In JavaScript, -0 >= 0 evaluates to true, which means -0 can pass through
 * minimum value constraints. Both functions should normalise negative zero
 * to positive zero to prevent subtle bugs (e.g. 1 / -0 === -Infinity).
 */

import { assertEquals } from "@std/assert";
import {
  parseDiscoverySampleRate,
  parseNumber,
} from "../../src/config/ParseOptions.ts";

// --- parseNumber tests ---

Deno.test("parseNumber - normalises -0 to 0 for numeric input", () => {
  const result = parseNumber("test", -0, 1);
  assertEquals(Object.is(result, -0), false, "Result should not be -0");
  assertEquals(result, 0, "Result should be positive 0");
});

Deno.test("parseNumber - normalises '-0' string to 0", () => {
  const result = parseNumber("test", "-0", 1);
  assertEquals(Object.is(result, -0), false, "Result should not be -0");
  assertEquals(result, 0, "Result should be positive 0");
});

Deno.test("parseNumber - positive zero passes through unchanged", () => {
  const result = parseNumber("test", 0, 1);
  assertEquals(result, 0);
});

Deno.test("parseNumber - normal positive numbers are unaffected", () => {
  assertEquals(parseNumber("test", 42, 0), 42);
  assertEquals(parseNumber("test", 0.5, 0), 0.5);
  assertEquals(parseNumber("test", "3.14", 0), 3.14);
});

Deno.test("parseNumber - normal negative numbers are unaffected", () => {
  assertEquals(parseNumber("test", -5, 0, { min: -10 }), -5);
  assertEquals(parseNumber("test", "-3.14", 0, { min: -10 }), -3.14);
});

// --- parseDiscoverySampleRate tests ---

Deno.test("parseDiscoverySampleRate - normalises -0 to 0 for numeric input", () => {
  const result = parseDiscoverySampleRate(-0, 0.5);
  assertEquals(Object.is(result, -0), false, "Result should not be -0");
  assertEquals(result, 0, "Result should be positive 0");
});

Deno.test("parseDiscoverySampleRate - normalises '-0' string to 0", () => {
  const result = parseDiscoverySampleRate("-0", 0.5);
  assertEquals(Object.is(result, -0), false, "Result should not be -0");
  assertEquals(result, 0, "Result should be positive 0");
});
