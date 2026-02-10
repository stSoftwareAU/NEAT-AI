/**
 * Issue #1368: Tests for parseNumber() handling of negative zero.
 *
 * In JavaScript, -0 >= 0 evaluates to true, which means -0 can pass through
 * minimum value constraints. The parseNumber() function should normalise
 * negative zero to positive zero to prevent subtle bugs.
 */

import { assertEquals } from "@std/assert";
import { parseNumber } from "../../src/config/ParseOptions.ts";

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
