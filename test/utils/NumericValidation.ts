/**
 * Unit tests for numeric validation helpers.
 *
 * Issue #2222: Shared helper to reduce repeated NaN/finite/non-negative
 * assertion patterns.
 *
 * @module
 */

import { assertThrows } from "@std/assert";
import {
  assertFiniteNonNegative,
  assertFiniteNumber,
} from "@utils/NumericValidation.ts";

// --- assertFiniteNonNegative ---

Deno.test("assertFiniteNonNegative accepts zero", () => {
  assertFiniteNonNegative(0, "value");
});

Deno.test("assertFiniteNonNegative accepts positive number", () => {
  assertFiniteNonNegative(42, "value");
});

Deno.test("assertFiniteNonNegative accepts small positive number", () => {
  assertFiniteNonNegative(0.000001, "value");
});

Deno.test("assertFiniteNonNegative rejects NaN", () => {
  assertThrows(
    () => assertFiniteNonNegative(NaN, "testVal"),
    Error,
    "testVal is NaN",
  );
});

Deno.test("assertFiniteNonNegative rejects positive Infinity", () => {
  assertThrows(
    () => assertFiniteNonNegative(Infinity, "testVal"),
    Error,
    "testVal is not finite",
  );
});

Deno.test("assertFiniteNonNegative rejects negative Infinity", () => {
  assertThrows(
    () => assertFiniteNonNegative(-Infinity, "testVal"),
    Error,
    "testVal is not finite",
  );
});

Deno.test("assertFiniteNonNegative rejects negative number", () => {
  assertThrows(
    () => assertFiniteNonNegative(-1, "testVal"),
    Error,
    "testVal is negative",
  );
});

Deno.test("assertFiniteNonNegative includes value in negative message", () => {
  assertThrows(
    () => assertFiniteNonNegative(-5.5, "myField"),
    Error,
    "myField is negative: -5.5",
  );
});

Deno.test("assertFiniteNonNegative includes value in not-finite message", () => {
  assertThrows(
    () => assertFiniteNonNegative(Infinity, "myField"),
    Error,
    "myField is not finite: Infinity",
  );
});

// --- assertFiniteNumber ---

Deno.test("assertFiniteNumber accepts zero", () => {
  assertFiniteNumber(0, "value");
});

Deno.test("assertFiniteNumber accepts positive number", () => {
  assertFiniteNumber(42, "value");
});

Deno.test("assertFiniteNumber accepts negative number", () => {
  assertFiniteNumber(-7.5, "value");
});

Deno.test("assertFiniteNumber rejects NaN", () => {
  assertThrows(
    () => assertFiniteNumber(NaN, "testVal"),
    Error,
    "testVal is NaN",
  );
});

Deno.test("assertFiniteNumber rejects positive Infinity", () => {
  assertThrows(
    () => assertFiniteNumber(Infinity, "testVal"),
    Error,
    "testVal is not finite",
  );
});

Deno.test("assertFiniteNumber rejects negative Infinity", () => {
  assertThrows(
    () => assertFiniteNumber(-Infinity, "testVal"),
    Error,
    "testVal is not finite",
  );
});
