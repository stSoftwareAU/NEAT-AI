/**
 * Tests for output range penalty calculation (Issue #1620).
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  calculateOutputRangePenalty,
} from "../../src/architecture/OutputRangePenalty.ts";
import type { RequiredOutputRange } from "../../src/config/OutputRangeConfig.ts";

Deno.test("OutputRangePenalty - no penalty for in-range outputs", () => {
  const ranges: RequiredOutputRange[] = [
    { min: -0.5, max: 0.5, penaltyWeight: 1.0 },
  ];
  const outputs = new Float32Array([0.25]);
  assertEquals(calculateOutputRangePenalty(outputs, ranges), 0);
});

Deno.test("OutputRangePenalty - no penalty at exact boundaries", () => {
  const ranges: RequiredOutputRange[] = [
    { min: -0.5, max: 0.5, penaltyWeight: 1.0 },
  ];
  assertEquals(
    calculateOutputRangePenalty(new Float32Array([-0.5]), ranges),
    0,
  );
  assertEquals(
    calculateOutputRangePenalty(new Float32Array([0.5]), ranges),
    0,
  );
});

Deno.test("OutputRangePenalty - penalty for output below min", () => {
  const ranges: RequiredOutputRange[] = [
    { min: -0.5, max: 0.5, penaltyWeight: 1.0 },
  ];
  // Output is -1.0, excess = 0.5, rangeSpan = 1.0, normalised = 0.5
  // penalty = 1.0 * 0.5^2 = 0.25
  const outputs = new Float32Array([-1.0]);
  assertAlmostEquals(calculateOutputRangePenalty(outputs, ranges), 0.25);
});

Deno.test("OutputRangePenalty - penalty for output above max", () => {
  const ranges: RequiredOutputRange[] = [
    { min: -0.5, max: 0.5, penaltyWeight: 1.0 },
  ];
  // Output is 1.5, excess = 1.0, rangeSpan = 1.0, normalised = 1.0
  // penalty = 1.0 * 1.0^2 = 1.0
  const outputs = new Float32Array([1.5]);
  assertAlmostEquals(calculateOutputRangePenalty(outputs, ranges), 1.0);
});

Deno.test("OutputRangePenalty - penaltyWeight scales the penalty", () => {
  const ranges: RequiredOutputRange[] = [
    { min: -0.5, max: 0.5, penaltyWeight: 2.0 },
  ];
  // Output is -1.0, excess = 0.5, normalised = 0.5
  // penalty = 2.0 * 0.25 = 0.5
  const outputs = new Float32Array([-1.0]);
  assertAlmostEquals(calculateOutputRangePenalty(outputs, ranges), 0.5);
});

Deno.test("OutputRangePenalty - multiple outputs accumulate penalties", () => {
  const ranges: RequiredOutputRange[] = [
    { min: -0.35, max: 0.35, penaltyWeight: 1.0 },
    { min: -0.50, max: 0.50, penaltyWeight: 1.0 },
  ];
  // Output 0: value = 0.7, excess = 0.35, rangeSpan = 0.7, normalised = 0.5
  // penalty0 = 0.25
  // Output 1: value = -1.0, excess = 0.5, rangeSpan = 1.0, normalised = 0.5
  // penalty1 = 0.25
  const outputs = new Float32Array([0.7, -1.0]);
  assertAlmostEquals(calculateOutputRangePenalty(outputs, ranges), 0.5);
});

Deno.test("OutputRangePenalty - empty ranges produce zero penalty", () => {
  const ranges: RequiredOutputRange[] = [];
  const outputs = new Float32Array([100.0]);
  assertEquals(calculateOutputRangePenalty(outputs, ranges), 0);
});

Deno.test("OutputRangePenalty - fewer ranges than outputs only checks covered outputs", () => {
  const ranges: RequiredOutputRange[] = [
    { min: 0, max: 1, penaltyWeight: 1.0 },
  ];
  // Only the first output is checked; the second has no range constraint
  const outputs = new Float32Array([0.5, 999.0]);
  assertEquals(calculateOutputRangePenalty(outputs, ranges), 0);
});

Deno.test("OutputRangePenalty - works with number arrays as well as Float32Array", () => {
  const ranges: RequiredOutputRange[] = [
    { min: -1, max: 1, penaltyWeight: 1.0 },
  ];
  // excess = 1, rangeSpan = 2, normalised = 0.5, penalty = 0.25
  const outputs = [2.0];
  assertAlmostEquals(calculateOutputRangePenalty(outputs, ranges), 0.25);
});

Deno.test("OutputRangePenalty - zero-width range produces raw excess penalty", () => {
  // When min === max, rangeSpan is 0, so normalised = excess (no division)
  const ranges: RequiredOutputRange[] = [
    { min: 0, max: 0, penaltyWeight: 1.0 },
  ];
  // Output is 0.5, excess = 0.5, normalised = 0.5 (raw excess)
  // penalty = 1.0 * 0.25 = 0.25
  const outputs = new Float32Array([0.5]);
  assertAlmostEquals(calculateOutputRangePenalty(outputs, ranges), 0.25);
});

Deno.test("OutputRangePenalty - quadratic scaling penalises large violations more", () => {
  const ranges: RequiredOutputRange[] = [
    { min: 0, max: 1, penaltyWeight: 1.0 },
  ];
  // Small violation: output = 1.1, excess = 0.1, normalised = 0.1
  // penalty = 0.01
  const smallViolation = calculateOutputRangePenalty(
    new Float32Array([1.1]),
    ranges,
  );
  // Large violation: output = 2.0, excess = 1.0, normalised = 1.0
  // penalty = 1.0
  const largeViolation = calculateOutputRangePenalty(
    new Float32Array([2.0]),
    ranges,
  );
  // Large violations should be much more penalised (100x for 10x excess)
  assertEquals(largeViolation > smallViolation * 10, true);
});
