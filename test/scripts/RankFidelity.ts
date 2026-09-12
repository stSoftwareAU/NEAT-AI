/**
 * Issue #3927: the rank-fidelity arithmetic that decides whether a cheap
 * fitness is usable. Every test here calls the real function with real data
 * and asserts on what it returned.
 *
 * The coefficients are checked against hand-worked values rather than against
 * each other, so a sign flip or a missing tie correction cannot hide.
 */

import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  adjacentGaps,
  assertFidelityRate,
  assessRate,
  averageRanks,
  distinctPhaseCount,
  gapResolution,
  kendallTau,
  median,
  phaseSpread,
  recommendRate,
  spearmanRho,
  strideForRate,
  stridePhaseIndices,
  topKAgreement,
} from "../../scripts/lib/rankFidelity.ts";

Deno.test("rank fidelity - a rate outside (0, 1] is refused, not measured", () => {
  assertFidelityRate(1);
  assertFidelityRate(0.01);
  for (const bad of [0, -0.1, 1.5, Number.NaN, Infinity]) {
    assertThrows(
      () => assertFidelityRate(bad),
      Error,
      "fitness sample rate",
    );
  }
});

Deno.test("rank fidelity - stride is the reciprocal of the rate", () => {
  assertEquals(strideForRate(1), 1);
  assertEquals(strideForRate(0.5), 2);
  assertEquals(strideForRate(0.25), 4);
  assertEquals(strideForRate(0.1), 10);
  assertEquals(strideForRate(0.01), 100);
});

Deno.test("rank fidelity - a rate has only as many phases as it has strata", () => {
  // Rate 0.5 has two strata: asking for four would measure two of them twice
  // and report a phase spread the estimator does not have.
  assertEquals(distinctPhaseCount(0.5, 4), 2);
  assertEquals(distinctPhaseCount(0.25, 4), 4);
  assertEquals(distinctPhaseCount(0.1, 4), 4);
  assertEquals(distinctPhaseCount(1, 4), 1);
  assertThrows(() => distinctPhaseCount(0.5, 0), Error, "positive integer");
});

Deno.test("rank fidelity - a phase selects its own stratum of the corpus", () => {
  assertEquals(stridePhaseIndices(10, 0.25, 0), [0, 4, 8]);
  assertEquals(stridePhaseIndices(10, 0.25, 1), [1, 5, 9]);
  assertEquals(stridePhaseIndices(10, 0.25, 3), [3, 7]);
  assertEquals(stridePhaseIndices(4, 1, 0), [0, 1, 2, 3]);
  assertThrows(
    () => stridePhaseIndices(10, 0.25, 4),
    Error,
    "outside [0, 4)",
  );
  // A stratum that would draw nothing must fail loudly rather than be scored
  // as an empty corpus.
  assertThrows(
    () => stridePhaseIndices(2, 0.1, 5),
    Error,
    "selected no records",
  );
});

Deno.test("rank fidelity - ties share their average rank", () => {
  assertEquals(averageRanks([10, 20, 30]), [1, 2, 3]);
  assertEquals(averageRanks([30, 10, 20]), [3, 1, 2]);
  // 5, 5 occupy ranks 1 and 2, so both take 1.5.
  assertEquals(averageRanks([5, 5, 9]), [1.5, 1.5, 3]);
  // 1 takes rank 1; the three 7s occupy ranks 2, 3 and 4 and share their mean.
  assertEquals(averageRanks([7, 7, 7, 1]), [3, 3, 3, 1]);
});

Deno.test("rank fidelity - Spearman is 1 for a preserved ordering and -1 for a reversed one", () => {
  const truth = [0.1, 0.2, 0.3, 0.4, 0.5];
  // Absolute error is enormous, the ordering is perfect: Jin's point.
  assertAlmostEquals(spearmanRho(truth, [100, 200, 300, 400, 500]), 1, 1e-12);
  assertAlmostEquals(spearmanRho(truth, [5, 4, 3, 2, 1]), -1, 1e-12);
});

Deno.test("rank fidelity - Spearman matches the hand-worked value for one swap", () => {
  // Ranks 1..5 against 2,1,3,4,5 — a single adjacent swap, sum d^2 = 2.
  // rho = 1 - 6*2 / (5 * 24) = 0.9
  assertAlmostEquals(
    spearmanRho([1, 2, 3, 4, 5], [2, 1, 3, 4, 5]),
    0.9,
    1e-12,
  );
});

Deno.test("rank fidelity - a constant score vector is unmeasurable, not uncorrelated", () => {
  assertThrows(
    () => spearmanRho([1, 2, 3], [7, 7, 7]),
    Error,
    "carries no ordering",
  );
});

Deno.test("rank fidelity - ragged, short, and non-finite score vectors are refused", () => {
  assertThrows(() => spearmanRho([1, 2], [1]), Error, "differ in length");
  assertThrows(() => kendallTau([1], [1]), Error, "at least 2 creatures");
  assertThrows(
    () => spearmanRho([1, Number.NaN], [1, 2]),
    Error,
    "non-finite score at index 1",
  );
});

Deno.test("rank fidelity - Kendall tau counts concordant against discordant pairs", () => {
  assertAlmostEquals(kendallTau([1, 2, 3, 4], [1, 2, 3, 4]), 1, 1e-12);
  assertAlmostEquals(kendallTau([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-12);
  // One adjacent swap out of 6 pairs: 5 concordant, 1 discordant -> 4/6.
  assertAlmostEquals(
    kendallTau([1, 2, 3, 4], [2, 1, 3, 4]),
    4 / 6,
    1e-12,
  );
});

Deno.test("rank fidelity - Kendall tau-b corrects for a tie the sampled score introduces", () => {
  // Pairs: (0,1) tied in sampled, (0,2) and (1,2) concordant.
  // tau-b = (2 - 0) / sqrt((2 + 0 + 0) * (2 + 0 + 1)) = 2 / sqrt(6)
  assertAlmostEquals(
    kendallTau([1, 2, 3], [5, 5, 9]),
    2 / Math.sqrt(6),
    1e-12,
  );
});

Deno.test("rank fidelity - top-k agreement looks only at the head of the ordering", () => {
  // The bottom four are ranked perfectly; the top two are swapped. Global rho
  // stays high, and this is the number that must not.
  const truth = [0.10, 0.11, 0.30, 0.40, 0.50, 0.60];
  const sampled = [0.11, 0.10, 0.30, 0.40, 0.50, 0.60];
  assertEquals(topKAgreement(truth, sampled, 1), 0);
  assertEquals(topKAgreement(truth, sampled, 3), 1);
  assertEquals(topKAgreement(truth, sampled, 5), 1);
  // A creature promoted into the top 3 from outside it costs one of three.
  const promoted = [0.10, 0.11, 0.90, 0.40, 0.50, 0.60];
  assertAlmostEquals(topKAgreement(truth, promoted, 3), 2 / 3, 1e-12);
});

Deno.test("rank fidelity - top-k refuses a k outside the population", () => {
  assertThrows(() => topKAgreement([1, 2], [1, 2], 0), Error, "k must be");
  assertThrows(() => topKAgreement([1, 2], [1, 2], 3), Error, "k must be");
});

Deno.test("rank fidelity - gap resolution reports the largest gap the sample got wrong", () => {
  // Sampled inverts the pair separated by 0.01 and the pair separated by 0.5.
  const truth = [1.00, 1.01, 1.50];
  const sampled = [1.60, 1.55, 1.50];
  // Every pair is inverted, so the coarsest inverted gap is 1.50 - 1.00.
  assertAlmostEquals(gapResolution(truth, sampled), 0.5, 1e-12);
  // A perfectly preserved ordering resolves everything.
  assertEquals(gapResolution(truth, [0.1, 0.2, 0.3]), 0);
});

Deno.test("rank fidelity - a sampled tie has not ordered a pair the full corpus separates", () => {
  const truth = [1.0, 1.2, 3.0];
  const sampled = [2.0, 2.0, 5.0];
  // The 0.2 pair is unresolved; the pairs against the third creature are fine.
  assertAlmostEquals(gapResolution(truth, sampled), 0.2, 1e-12);
});

Deno.test("rank fidelity - gap resolution ignores pairs the full corpus does not order", () => {
  const truth = [1.0, 1.0, 2.0];
  const sampled = [9.0, 1.0, 5.0];
  // (0,1) has a zero truth gap, so the sample cannot be wrong about it;
  // (0,2) is inverted with a gap of 1.
  assertAlmostEquals(gapResolution(truth, sampled), 1, 1e-12);
});

Deno.test("rank fidelity - adjacent gaps describe the margins the search resolves", () => {
  const gaps = adjacentGaps([0.5, 0.1, 0.2]);
  assertEquals(gaps.length, 2);
  assertAlmostEquals(gaps[0], 0.1, 1e-12);
  assertAlmostEquals(gaps[1], 0.3, 1e-12);
  // Duplicate scores are not margins the search has to resolve.
  assertEquals(adjacentGaps([1, 1, 2]), [1]);
  assertThrows(() => adjacentGaps([1]), Error, "at least 2 scores");
});

Deno.test("rank fidelity - median of an empty set is refused", () => {
  assertEquals(median([3, 1, 2]), 2);
  assertEquals(median([4, 1, 2, 3]), 2.5);
  assertThrows(() => median([]), Error, "empty set");
});

Deno.test("rank fidelity - phase spread is the estimator's own noise", () => {
  const spread = phaseSpread([
    [1.0, 2.0, 3.0],
    [1.2, 2.0, 2.5],
    [0.9, 2.1, 3.0],
  ]);
  assertAlmostEquals(spread.max, 0.5, 1e-12);
  assertAlmostEquals(spread.mean, (0.30000000000000004 + 0.1 + 0.5) / 3, 1e-12);
});

Deno.test("rank fidelity - one stratum reports unmeasurable spread, never zero", () => {
  const spread = phaseSpread([[1.0, 2.0]]);
  assertEquals(Number.isNaN(spread.max), true);
  assertEquals(Number.isNaN(spread.mean), true);
  assertThrows(() => phaseSpread([]), Error, "no phases measured");
  assertThrows(
    () => phaseSpread([[1, 2], [1]]),
    Error,
    "different populations",
  );
});

Deno.test("rank fidelity - a rate that trips no failure signal is safe", () => {
  const verdict = assessRate(
    { rate: 0.1, top1: 1, gapResolution: 2e-6, phaseSpreadMax: 1e-6 },
    { minTop1: 0.9, acceptGap: 1e-5, adjacentGap: 1e-5 },
  );
  assertEquals(verdict.safe, true);
  assertEquals(verdict.failures, []);
});

Deno.test("rank fidelity - every failure signal in Issue #3927 is reported", () => {
  const verdict = assessRate(
    { rate: 0.01, top1: 0.5, gapResolution: 3e-3, phaseSpreadMax: 4e-3 },
    { minTop1: 0.9, acceptGap: 1e-5, adjacentGap: 1e-5 },
  );
  assertEquals(verdict.safe, false);
  assertEquals(verdict.failures.length, 3);
  assertEquals(verdict.failures[0].includes("top-1 agreement"), true);
  assertEquals(verdict.failures[1].includes("score-gap resolution"), true);
  assertEquals(verdict.failures[2].includes("phase-to-phase spread"), true);
});

Deno.test("rank fidelity - an unmeasurable phase spread is a failure signal, not a pass", () => {
  const verdict = assessRate(
    { rate: 0.5, top1: 1, gapResolution: 0, phaseSpreadMax: Number.NaN },
    { minTop1: 0.9, acceptGap: 1e-5, adjacentGap: 1e-5 },
  );
  assertEquals(verdict.safe, false);
  assertEquals(verdict.failures[0].includes("unmeasurable"), true);
});

Deno.test("rank fidelity - the cheapest safe rate is recommended", () => {
  assertEquals(
    recommendRate([
      { rate: 0.5, safe: true, failures: [] },
      { rate: 0.1, safe: true, failures: [] },
      { rate: 0.01, safe: false, failures: ["top-1"] },
    ]),
    0.1,
  );
});

Deno.test("rank fidelity - no safe rate is a reportable result, not an exception", () => {
  assertEquals(
    recommendRate([
      { rate: 0.5, safe: false, failures: ["top-1"] },
      { rate: 0.1, safe: false, failures: ["top-1"] },
    ]),
    null,
  );
});
