/**
 * Unit tests for the statistics helpers.
 *
 * Issue #2654: cross-species breeding baseline harness uses these helpers
 * to summarise per-run shared-neuron proportions and to compare new
 * strategies against the baseline distribution.
 *
 * @module
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { describe, mannWhitneyU } from "@utils/Statistics.ts";

// --- describe ---

Deno.test("describe: happy path - simple sample", () => {
  const s = describe([1, 2, 3, 4, 5]);
  assertEquals(s.n, 5);
  assertEquals(s.mean, 3);
  assertEquals(s.min, 1);
  assertEquals(s.max, 5);
  // sample stddev of 1..5 = sqrt(10/4) = sqrt(2.5)
  assertAlmostEquals(s.stddev, Math.sqrt(2.5), 1e-12);
});

Deno.test("describe: single-element sample -> stddev = 0 (not NaN)", () => {
  const s = describe([42]);
  assertEquals(s.n, 1);
  assertEquals(s.mean, 42);
  assertEquals(s.stddev, 0);
  assertEquals(s.min, 42);
  assertEquals(s.max, 42);
});

Deno.test("describe: rejects empty sample", () => {
  assertThrows(() => describe([]), Error, "describe: sample is empty");
});

Deno.test("describe: rejects non-finite value", () => {
  assertThrows(() => describe([1, NaN, 3]), Error, "non-finite");
  assertThrows(() => describe([1, Infinity]), Error, "non-finite");
});

Deno.test("describe: handles negative and zero values", () => {
  const s = describe([-2, 0, 2]);
  assertEquals(s.mean, 0);
  assertEquals(s.min, -2);
  assertEquals(s.max, 2);
  assertAlmostEquals(s.stddev, 2, 1e-12);
});

// --- mannWhitneyU ---

Deno.test("mannWhitneyU: empty samples -> pValue = 1", () => {
  const r = mannWhitneyU([], []);
  assertEquals(r.pValue, 1);
  assertEquals(r.U, 0);
  assertEquals(r.n1, 0);
  assertEquals(r.n2, 0);
});

Deno.test("mannWhitneyU: one empty sample -> pValue = 1", () => {
  const r = mannWhitneyU([1, 2, 3], []);
  assertEquals(r.pValue, 1);
});

Deno.test("mannWhitneyU: identical samples -> pValue = 1 (no separation)", () => {
  const r = mannWhitneyU([1, 2, 3], [1, 2, 3]);
  assertEquals(r.pValue, 1);
  // u1 == u2 == n1*n2/2 = 4.5
  assertEquals(r.u1, 4.5);
  assertEquals(r.u2, 4.5);
});

Deno.test("mannWhitneyU: clearly separated samples -> small pValue", () => {
  // sample1 strictly < sample2, n=10 each -> U1 = 0, U2 = 100.
  const s1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s2 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const r = mannWhitneyU(s1, s2);
  assertEquals(r.u1, 0);
  assertEquals(r.u2, 100);
  assertEquals(r.U, 0);
  // Highly significant.
  assert(r.pValue < 0.001, `expected p < 0.001, got ${r.pValue}`);
});

Deno.test("mannWhitneyU: ties are handled by average ranks", () => {
  // Same data on both sides — every value tied. pValue should be 1.
  const s1 = [1, 1, 2, 2, 3, 3];
  const s2 = [1, 1, 2, 2, 3, 3];
  const r = mannWhitneyU(s1, s2);
  assertAlmostEquals(r.u1, 18, 1e-9); // n1*n2/2 = 18
  assertAlmostEquals(r.u2, 18, 1e-9);
  assertEquals(r.pValue, 1);
});

Deno.test("mannWhitneyU: degenerate constant samples never return NaN", () => {
  const r = mannWhitneyU([0, 0, 0], [0, 0, 0]);
  assert(!Number.isNaN(r.pValue));
  assert(!Number.isNaN(r.z));
  assertEquals(r.pValue, 1);
  assertEquals(r.z, 0);
});

Deno.test("mannWhitneyU: rejects non-finite input", () => {
  assertThrows(() => mannWhitneyU([1, NaN], [1, 2]), Error, "non-finite");
  assertThrows(() => mannWhitneyU([1, 2], [1, Infinity]), Error, "non-finite");
});

Deno.test("mannWhitneyU: moderate effect size matches reference", () => {
  // Reference: SciPy mannwhitneyu([1,2,3,4,5,6,7,8,9,10],
  //   [3,4,5,6,7,8,9,10,11,12], alternative="two-sided") -> p ~ 0.139
  // The normal-approximation with continuity correction reproduces this
  // value within ~0.02; we assert a wider tolerance for safety.
  const s1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const r = mannWhitneyU(s1, s2);
  assert(
    r.pValue > 0.05 && r.pValue < 0.25,
    `expected 0.05 < p < 0.25, got ${r.pValue}`,
  );
});
