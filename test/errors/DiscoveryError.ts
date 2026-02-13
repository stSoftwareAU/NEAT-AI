import { assert, assertEquals, assertIsError, assertThrows } from "@std/assert";
import {
  DiscoveryError,
  type DiscoveryErrorReason,
} from "../../src/errors/DiscoveryError.ts";

Deno.test("DiscoveryError - LIBRARY_NOT_FOUND reason", () => {
  const error = new DiscoveryError(
    "Rust library not found",
    "LIBRARY_NOT_FOUND",
  );
  assertIsError(error, DiscoveryError);
  assertEquals(error.message, "Rust library not found");
  assertEquals(error.reason, "LIBRARY_NOT_FOUND");
  assertEquals(error.name, "DiscoveryError");
});

Deno.test("DiscoveryError - GPU_UNAVAILABLE reason", () => {
  const error = new DiscoveryError(
    "Metal/GPU compute not available",
    "GPU_UNAVAILABLE",
  );
  assertIsError(error, DiscoveryError);
  assertEquals(error.reason, "GPU_UNAVAILABLE");
});

Deno.test("DiscoveryError - FFI_CRASH reason", () => {
  const error = new DiscoveryError(
    "Library returned unexpected exit code",
    "FFI_CRASH",
  );
  assertIsError(error, DiscoveryError);
  assertEquals(error.reason, "FFI_CRASH");
});

Deno.test("DiscoveryError - TIMEOUT reason", () => {
  const error = new DiscoveryError(
    "Discovery operation timed out",
    "TIMEOUT",
  );
  assertIsError(error, DiscoveryError);
  assertEquals(error.reason, "TIMEOUT");
});

Deno.test("DiscoveryError - DATA_CORRUPTION reason", () => {
  const error = new DiscoveryError(
    "Neuron error counts exceed reasonable maximum",
    "DATA_CORRUPTION",
  );
  assertIsError(error, DiscoveryError);
  assertEquals(error.reason, "DATA_CORRUPTION");
});

Deno.test("DiscoveryError - INVALID_CREATURE reason", () => {
  const error = new DiscoveryError(
    "Discovery operation produced an invalid creature",
    "INVALID_CREATURE",
  );
  assertIsError(error, DiscoveryError);
  assertEquals(error.reason, "INVALID_CREATURE");
});

Deno.test("DiscoveryError - is instanceof Error", () => {
  const error = new DiscoveryError("test", "LIBRARY_NOT_FOUND");
  assert(error instanceof Error);
  assert(error instanceof DiscoveryError);
});

Deno.test("DiscoveryError - can be caught selectively", () => {
  const fn = () => {
    throw new DiscoveryError("lib not found", "LIBRARY_NOT_FOUND");
  };

  assertThrows(fn, DiscoveryError);
});

Deno.test("DiscoveryError - reason is typed", () => {
  // Verify all expected reason values are valid
  const reasons: DiscoveryErrorReason[] = [
    "LIBRARY_NOT_FOUND",
    "GPU_UNAVAILABLE",
    "FFI_CRASH",
    "TIMEOUT",
    "DATA_CORRUPTION",
    "INVALID_CREATURE",
  ];

  for (const reason of reasons) {
    const error = new DiscoveryError(`test: ${reason}`, reason);
    assertEquals(error.reason, reason);
  }
});
