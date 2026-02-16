import { assert, assertEquals, assertIsError, assertThrows } from "@std/assert";
import {
  TopologyError,
  type TopologyErrorReason,
} from "../../src/errors/TopologyError.ts";

Deno.test("TopologyError - INVALID_NEURON_TYPE reason", () => {
  const error = new TopologyError(
    "invalid type: foo",
    "INVALID_NEURON_TYPE",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.message, "invalid type: foo");
  assertEquals(error.reason, "INVALID_NEURON_TYPE");
  assertEquals(error.name, "TopologyError");
});

Deno.test("TopologyError - INVALID_SQUASH reason", () => {
  const error = new TopologyError(
    "constants should not have a squash was: TANH",
    "INVALID_SQUASH",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "INVALID_SQUASH");
});

Deno.test("TopologyError - MISSING_SQUASH reason", () => {
  const error = new TopologyError(
    "Missing squash for hidden neuron",
    "MISSING_SQUASH",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "MISSING_SQUASH");
});

Deno.test("TopologyError - INVALID_CONNECTION reason", () => {
  const error = new TopologyError(
    "connection points to an input node",
    "INVALID_CONNECTION",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "INVALID_CONNECTION");
});

Deno.test("TopologyError - INVALID_STATE reason", () => {
  const error = new TopologyError(
    "hidden neuron should have a finite bias",
    "INVALID_STATE",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "INVALID_STATE");
});

Deno.test("TopologyError - DUPLICATE_UUID reason", () => {
  const error = new TopologyError(
    "Duplicate uuid abc-123",
    "DUPLICATE_UUID",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "DUPLICATE_UUID");
});

Deno.test("TopologyError - MISSING_NEURON reason", () => {
  const error = new TopologyError(
    "Can't find neuron-abc",
    "MISSING_NEURON",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "MISSING_NEURON");
});

Deno.test("TopologyError - SORT_FAILURE reason", () => {
  const error = new TopologyError(
    "synapses not sorted",
    "SORT_FAILURE",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "SORT_FAILURE");
});

Deno.test("TopologyError - EXCESSIVE_ERRORS reason", () => {
  const error = new TopologyError(
    "Excessive error accumulation detected",
    "EXCESSIVE_ERRORS",
  );
  assertIsError(error, TopologyError);
  assertEquals(error.reason, "EXCESSIVE_ERRORS");
});

Deno.test("TopologyError - is instanceof Error", () => {
  const error = new TopologyError("test", "INVALID_NEURON_TYPE");
  assert(error instanceof Error);
  assert(error instanceof TopologyError);
});

Deno.test("TopologyError - can be caught selectively", () => {
  const fn = () => {
    throw new TopologyError("bad topology", "INVALID_CONNECTION");
  };

  assertThrows(fn, TopologyError);
});

Deno.test("TopologyError - reason is typed", () => {
  const reasons: TopologyErrorReason[] = [
    "INVALID_NEURON_TYPE",
    "INVALID_SQUASH",
    "MISSING_SQUASH",
    "INVALID_CONNECTION",
    "INVALID_STATE",
    "DUPLICATE_UUID",
    "MISSING_NEURON",
    "SORT_FAILURE",
    "EXCESSIVE_ERRORS",
  ];

  for (const reason of reasons) {
    const error = new TopologyError(`test: ${reason}`, reason);
    assertEquals(error.reason, reason);
  }
});

Deno.test("TopologyError - distinguishable from generic Error", () => {
  try {
    throw new TopologyError("bad topology", "INVALID_CONNECTION");
  } catch (e) {
    if (e instanceof TopologyError) {
      assertEquals(e.reason, "INVALID_CONNECTION");
    } else {
      throw new Error("Expected TopologyError instance");
    }
  }
});
