/**
 * Tests verifying TopologyError with EXCESSIVE_ERRORS reason can be
 * created and caught by type.
 *
 * Issue #1694
 */
import { assertEquals, assertIsError } from "@std/assert";
import { TopologyError } from "@errors/TopologyError.ts";

Deno.test("TopologyError EXCESSIVE_ERRORS - has correct reason and message", () => {
  const err = new TopologyError(
    "Excessive errors detected: 10000 total errors",
    "EXCESSIVE_ERRORS",
  );
  assertIsError(err, TopologyError);
  assertEquals(err.reason, "EXCESSIVE_ERRORS");
  assertEquals(err.message, "Excessive errors detected: 10000 total errors");
});

Deno.test("TopologyError - is instance of Error", () => {
  const err = new TopologyError("test error", "EXCESSIVE_ERRORS");
  assertIsError(err, Error);
  assertIsError(err, TopologyError);
});
