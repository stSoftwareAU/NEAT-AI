/**
 * Unit tests for SquashUtils - aggregation squash classification.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { isAggregationSquash } from "../../../src/methods/activations/SquashUtils.ts";

Deno.test("isAggregationSquash returns true for MAXIMUM", () => {
  assertEquals(isAggregationSquash("MAXIMUM"), true);
});

Deno.test("isAggregationSquash returns true for MINIMUM", () => {
  assertEquals(isAggregationSquash("MINIMUM"), true);
});

Deno.test("isAggregationSquash returns true for IF", () => {
  assertEquals(isAggregationSquash("IF"), true);
});

Deno.test("isAggregationSquash returns true for HYPOT", () => {
  assertEquals(isAggregationSquash("HYPOT"), true);
});

Deno.test("isAggregationSquash returns true for HYPOTv2", () => {
  assertEquals(isAggregationSquash("HYPOTv2"), true);
});

Deno.test("isAggregationSquash returns false for ReLU", () => {
  assertEquals(isAggregationSquash("ReLU"), false);
});

Deno.test("isAggregationSquash returns false for LOGISTIC", () => {
  assertEquals(isAggregationSquash("LOGISTIC"), false);
});

Deno.test("isAggregationSquash returns false for TANH", () => {
  assertEquals(isAggregationSquash("TANH"), false);
});

Deno.test("isAggregationSquash returns false for IDENTITY", () => {
  assertEquals(isAggregationSquash("IDENTITY"), false);
});

Deno.test("isAggregationSquash returns false for undefined", () => {
  assertEquals(isAggregationSquash(undefined), false);
});

Deno.test("isAggregationSquash returns false for empty string", () => {
  assertEquals(isAggregationSquash(""), false);
});

Deno.test("isAggregationSquash returns false for unknown name", () => {
  assertEquals(isAggregationSquash("UNKNOWN_SQUASH"), false);
});
