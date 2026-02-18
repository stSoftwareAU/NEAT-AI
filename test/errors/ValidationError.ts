/**
 * Unit tests for ValidationError.
 *
 * @module
 */

import { assert, assertEquals, assertIsError, assertThrows } from "@std/assert";
import {
  ValidationError,
  type ValidationErrorName,
} from "../../src/errors/ValidationError.ts";

Deno.test("ValidationError - OTHER reason", () => {
  const error = new ValidationError("something went wrong", "OTHER");
  assertIsError(error, ValidationError);
  assertEquals(error.message, "something went wrong");
  assertEquals(error.name, "OTHER");
});

Deno.test("ValidationError - NO_OUTWARD_CONNECTIONS reason", () => {
  const error = new ValidationError(
    "neuron has no outward connections",
    "NO_OUTWARD_CONNECTIONS",
  );
  assertEquals(error.name, "NO_OUTWARD_CONNECTIONS");
});

Deno.test("ValidationError - NO_INWARD_CONNECTIONS reason", () => {
  const error = new ValidationError(
    "neuron has no inward connections",
    "NO_INWARD_CONNECTIONS",
  );
  assertEquals(error.name, "NO_INWARD_CONNECTIONS");
});

Deno.test("ValidationError - IF_CONDITIONS reason", () => {
  const error = new ValidationError(
    "IF conditions are invalid",
    "IF_CONDITIONS",
  );
  assertEquals(error.name, "IF_CONDITIONS");
});

Deno.test("ValidationError - RECURSIVE_SYNAPSE reason", () => {
  const error = new ValidationError(
    "recursive synapse detected",
    "RECURSIVE_SYNAPSE",
  );
  assertEquals(error.name, "RECURSIVE_SYNAPSE");
});

Deno.test("ValidationError - SELF_CONNECTION reason", () => {
  const error = new ValidationError(
    "self-connection not allowed",
    "SELF_CONNECTION",
  );
  assertEquals(error.name, "SELF_CONNECTION");
});

Deno.test("ValidationError - MEMETIC reason", () => {
  const error = new ValidationError("memetic validation failed", "MEMETIC");
  assertEquals(error.name, "MEMETIC");
});

Deno.test("ValidationError - is instanceof Error", () => {
  const error = new ValidationError("test", "OTHER");
  assert(error instanceof Error);
  assert(error instanceof ValidationError);
});

Deno.test("ValidationError - can be caught selectively", () => {
  assertThrows(
    () => {
      throw new ValidationError("test error", "OTHER");
    },
    ValidationError,
  );
});

Deno.test("ValidationError - all reasons are valid", () => {
  const reasons: ValidationErrorName[] = [
    "OTHER",
    "NO_OUTWARD_CONNECTIONS",
    "NO_INWARD_CONNECTIONS",
    "IF_CONDITIONS",
    "RECURSIVE_SYNAPSE",
    "SELF_CONNECTION",
    "MEMETIC",
  ];

  for (const reason of reasons) {
    const error = new ValidationError(`test: ${reason}`, reason);
    assertEquals(error.name, reason);
  }
});

Deno.test("ValidationError - distinguishable in catch block", () => {
  try {
    throw new ValidationError("no connections", "NO_OUTWARD_CONNECTIONS");
  } catch (e) {
    if (e instanceof ValidationError) {
      assertEquals(e.name, "NO_OUTWARD_CONNECTIONS");
      assertEquals(e.message, "no connections");
    } else {
      throw new Error("Expected ValidationError instance");
    }
  }
});
