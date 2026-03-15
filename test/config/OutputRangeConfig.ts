/**
 * Tests for output range configuration parsing and validation (Issue #1620).
 */
import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import {
  DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT,
} from "../../src/config/OutputRangeConfig.ts";

Deno.test("OutputRangeConfig - defaults to empty array when not specified", () => {
  const config = createNeatConfig({});
  assertEquals(config.outputRanges.length, 0);
});

Deno.test("OutputRangeConfig - accepts valid output ranges", () => {
  const config = createNeatConfig({
    outputRanges: [
      { min: -0.35, max: 0.35 },
      { min: -0.50, max: 0.50 },
    ],
  });
  assertEquals(config.outputRanges.length, 2);
  assertEquals(config.outputRanges[0].min, -0.35);
  assertEquals(config.outputRanges[0].max, 0.35);
  assertEquals(
    config.outputRanges[0].penaltyWeight,
    DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT,
  );
  assertEquals(config.outputRanges[1].min, -0.50);
  assertEquals(config.outputRanges[1].max, 0.50);
});

Deno.test("OutputRangeConfig - custom penalty weight is preserved", () => {
  const config = createNeatConfig({
    outputRanges: [
      { min: -1, max: 1, penaltyWeight: 2.5 },
    ],
  });
  assertEquals(config.outputRanges[0].penaltyWeight, 2.5);
});

Deno.test("OutputRangeConfig - default penalty weight applied when omitted", () => {
  const config = createNeatConfig({
    outputRanges: [
      { min: 0, max: 1 },
    ],
  });
  assertEquals(
    config.outputRanges[0].penaltyWeight,
    DEFAULT_OUTPUT_RANGE_PENALTY_WEIGHT,
  );
});

Deno.test("OutputRangeConfig - throws when min > max", () => {
  assertThrows(
    () =>
      createNeatConfig({
        outputRanges: [
          { min: 1, max: -1 },
        ],
      }),
    Error,
    "max",
  );
});

Deno.test("OutputRangeConfig - throws when penaltyWeight is negative", () => {
  assertThrows(
    () =>
      createNeatConfig({
        outputRanges: [
          { min: 0, max: 1, penaltyWeight: -0.5 },
        ],
      }),
    Error,
    "penaltyWeight",
  );
});

Deno.test("OutputRangeConfig - allows min equal to max (single-point range)", () => {
  const config = createNeatConfig({
    outputRanges: [
      { min: 0.5, max: 0.5 },
    ],
  });
  assertEquals(config.outputRanges[0].min, 0.5);
  assertEquals(config.outputRanges[0].max, 0.5);
});

Deno.test("OutputRangeConfig - negative ranges are valid", () => {
  const config = createNeatConfig({
    outputRanges: [
      { min: -10, max: -5 },
    ],
  });
  assertEquals(config.outputRanges[0].min, -10);
  assertEquals(config.outputRanges[0].max, -5);
});

Deno.test("OutputRangeConfig - config is immutable after creation", () => {
  const config = createNeatConfig({
    outputRanges: [
      { min: 0, max: 1 },
    ],
  });
  assertThrows(() => {
    (config as Record<string, unknown>).outputRanges = [];
  });
});
