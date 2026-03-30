/**
 * Tests for the shared isAggregationSquash utility (from SquashUtils.ts).
 * Issue #1392 (resolved): Unified duplicate isAggregationSquash into a single
 * shared utility in src/methods/activations/SquashUtils.ts.
 */
import { assertEquals } from "@std/assert";
import { isAggregationSquash } from "@methods/activations/SquashUtils.ts";

Deno.test("isAggregationSquash - returns true for aggregation squashes", () => {
  const aggregationSquashes = ["MAXIMUM", "MINIMUM", "IF", "HYPOT", "HYPOTv2"];
  for (const squash of aggregationSquashes) {
    assertEquals(
      isAggregationSquash(squash),
      true,
      `Expected ${squash} to be an aggregation squash`,
    );
  }
});

Deno.test("isAggregationSquash - returns false for non-aggregation squashes", () => {
  const nonAggregationSquashes = ["LOGISTIC", "IDENTITY", "TANH", "ReLU"];
  for (const squash of nonAggregationSquashes) {
    assertEquals(
      isAggregationSquash(squash),
      false,
      `Expected ${squash} not to be an aggregation squash`,
    );
  }
});

Deno.test("isAggregationSquash - returns false for undefined and empty string", () => {
  assertEquals(isAggregationSquash(undefined), false);
  assertEquals(isAggregationSquash(""), false);
});
