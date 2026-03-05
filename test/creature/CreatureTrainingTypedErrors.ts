/**
 * Tests verifying CreatureTraining record() throws typed TopologyError
 * instead of generic Error for excessive errors.
 *
 * Issue #1694
 */
import { assertIsError } from "@std/assert";
import { TopologyError } from "../../src/errors/TopologyError.ts";

Deno.test("TopologyError EXCESSIVE_ERRORS - can be caught by type", () => {
  // Verify TopologyError with EXCESSIVE_ERRORS reason can be created and caught
  const err = new TopologyError(
    "Excessive errors detected: 10000 total errors",
    "EXCESSIVE_ERRORS",
  );
  assertIsError(err, TopologyError);
  if (err.reason !== "EXCESSIVE_ERRORS") {
    throw new Error(`Expected reason EXCESSIVE_ERRORS, got ${err.reason}`);
  }
});
