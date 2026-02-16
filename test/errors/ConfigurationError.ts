import { assert, assertEquals, assertIsError, assertThrows } from "@std/assert";
import {
  ConfigurationError,
  type ConfigurationErrorReason,
} from "../../src/errors/ConfigurationError.ts";

Deno.test("ConfigurationError - INVALID_TYPE reason", () => {
  const error = new ConfigurationError(
    "Threads must be a number or string, got: boolean",
    "INVALID_TYPE",
  );
  assertIsError(error, ConfigurationError);
  assertEquals(
    error.message,
    "Threads must be a number or string, got: boolean",
  );
  assertEquals(error.reason, "INVALID_TYPE");
  assertEquals(error.name, "ConfigurationError");
});

Deno.test("ConfigurationError - OUT_OF_RANGE reason", () => {
  const error = new ConfigurationError(
    "Population Size must be at least 2, got: 0",
    "OUT_OF_RANGE",
  );
  assertIsError(error, ConfigurationError);
  assertEquals(error.reason, "OUT_OF_RANGE");
});

Deno.test("ConfigurationError - NOT_INTEGER reason", () => {
  const error = new ConfigurationError(
    "Threads must be an integer, got: 3.5",
    "NOT_INTEGER",
  );
  assertIsError(error, ConfigurationError);
  assertEquals(error.reason, "NOT_INTEGER");
});

Deno.test("ConfigurationError - NOT_FINITE reason", () => {
  const error = new ConfigurationError(
    "Target error must be a finite number, got: Infinity",
    "NOT_FINITE",
  );
  assertIsError(error, ConfigurationError);
  assertEquals(error.reason, "NOT_FINITE");
});

Deno.test("ConfigurationError - CROSS_FIELD_VALIDATION reason", () => {
  const error = new ConfigurationError(
    "Quantum step maxStep must be >= minStep",
    "CROSS_FIELD_VALIDATION",
  );
  assertIsError(error, ConfigurationError);
  assertEquals(error.reason, "CROSS_FIELD_VALIDATION");
});

Deno.test("ConfigurationError - is instanceof Error", () => {
  const error = new ConfigurationError("test", "INVALID_TYPE");
  assert(error instanceof Error);
  assert(error instanceof ConfigurationError);
});

Deno.test("ConfigurationError - can be caught selectively", () => {
  const fn = () => {
    throw new ConfigurationError("bad config", "OUT_OF_RANGE");
  };

  assertThrows(fn, ConfigurationError);
});

Deno.test("ConfigurationError - reason is typed", () => {
  const reasons: ConfigurationErrorReason[] = [
    "INVALID_TYPE",
    "OUT_OF_RANGE",
    "NOT_INTEGER",
    "NOT_FINITE",
    "CROSS_FIELD_VALIDATION",
  ];

  for (const reason of reasons) {
    const error = new ConfigurationError(`test: ${reason}`, reason);
    assertEquals(error.reason, reason);
  }
});

Deno.test("ConfigurationError - distinguishable from generic Error", () => {
  try {
    throw new ConfigurationError("bad value", "OUT_OF_RANGE");
  } catch (e) {
    if (e instanceof ConfigurationError) {
      assertEquals(e.reason, "OUT_OF_RANGE");
    } else {
      throw new Error("Expected ConfigurationError instance");
    }
  }
});
