/**
 * Stage 1 arithmetic for the memetic local-search budget (Issue #3934).
 *
 * Every statistic is checked against a sample whose answer is known by
 * construction, because a correlation coefficient is exactly the kind of code
 * that looks right while being off by a tie correction — and the whole go/no-go
 * for Stage 2 hangs on it.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  averageRanks,
  correlateRankAgainstGain,
  type GainObservation,
  kendallTauB,
  MIN_STAGE1_EVENTS,
  pearson,
  permutationPValue,
  spearman,
  STAGE2_MIN_ABS_RHO,
  stage2Verdict,
  summarisePolicy,
} from "../../scripts/lib/memeticGainAnalysis.ts";

Deno.test("averageRanks - ties share their mean rank", () => {
  assertEquals(averageRanks([10, 20, 30]), [1, 2, 3]);
  assertEquals(averageRanks([5, 5, 9]), [1.5, 1.5, 3]);
  assertEquals(averageRanks([7, 7, 7, 7]), [2.5, 2.5, 2.5, 2.5]);
  assertEquals(averageRanks([3, 1, 2]), [3, 1, 2]);
});

Deno.test("pearson - perfect agreement and perfect inversion", () => {
  assertAlmostEquals(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12);
  assertAlmostEquals(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1, 1e-12);
});

Deno.test("pearson - a constant column orders nothing", () => {
  assertEquals(pearson([1, 1, 1], [4, 9, 2]), 0);
  assertEquals(pearson([1], [2]), 0);
});

Deno.test("pearson - refuses samples of different lengths", () => {
  assertThrows(() => pearson([1, 2], [1, 2, 3]), Error);
});

Deno.test("spearman - monotone but non-linear still reads as +1", () => {
  // Pearson would not: the relationship is cubic.
  assertAlmostEquals(spearman([1, 2, 3, 4], [1, 8, 27, 64]), 1, 1e-12);
  assertAlmostEquals(spearman([1, 2, 3, 4], [64, 27, 8, 1]), -1, 1e-12);
});

Deno.test("kendallTauB - known concordance", () => {
  assertAlmostEquals(kendallTauB([1, 2, 3], [1, 2, 3]), 1, 1e-12);
  assertAlmostEquals(kendallTauB([1, 2, 3], [3, 2, 1]), -1, 1e-12);
  // One inversion out of three pairs: (3-1)/3.
  assertAlmostEquals(kendallTauB([1, 2, 3], [1, 3, 2]), 1 / 3, 1e-12);
  // Every pair ties on one side, so nothing is ordered.
  assertEquals(kendallTauB([1, 1, 1], [1, 2, 3]), 0);
});

Deno.test("kendallTauB - refuses samples of different lengths", () => {
  assertThrows(() => kendallTauB([1], [1, 2]), Error);
});

Deno.test("permutationPValue - a real relationship survives, noise does not", () => {
  const xs = Array.from({ length: 30 }, (_, i) => i);
  const monotone = xs.map((x) => x * 2);
  assert(
    permutationPValue(xs, monotone, 1, 200) < 0.02,
    "a perfect ordering must not look like chance",
  );
  // A sawtooth with no monotone component: ρ near zero.
  const noise = xs.map((x) => (x % 3) - 1);
  assert(
    permutationPValue(xs, noise, 1, 200) > 0.2,
    "an unordered sample must not look significant",
  );
});

Deno.test("permutationPValue - never reports exactly zero", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  assert(permutationPValue(xs, xs, 7, 100) > 0);
});

/** Events with the gains named, so every statistic has a known answer. */
function observations(
  gains: readonly (number | undefined)[],
  wallClockMs = 1_000,
): GainObservation[] {
  return gains.map((gain, rank) => ({ rank, gain, wallClockMs }));
}

Deno.test("summarisePolicy - centre, spread and the cost behind them", () => {
  const summary = summarisePolicy(observations([-1, 0, 1, 2]));
  assertEquals(summary.events, 4);
  assertEquals(summary.scored, 4);
  assertEquals(summary.failed, 0);
  assertEquals(summary.meanGain, 0.5);
  assertEquals(summary.medianGain, 0.5);
  assertEquals(summary.maxGain, 2);
  assertEquals(summary.improvedFraction, 0.5);
  assertEquals(summary.trainingSeconds, 4);
  // Total over total: 2 of gain bought with 4 seconds of training.
  assertEquals(summary.gainPerSecond, 0.5);
});

Deno.test("summarisePolicy - a failed step costs its wall-clock but has no gain", () => {
  const summary = summarisePolicy(observations([1, undefined, 3]));
  assertEquals(summary.events, 3);
  assertEquals(summary.scored, 2);
  assertEquals(summary.failed, 1);
  assertEquals(summary.meanGain, 2);
  // Three seconds were paid for, including the failure's.
  assertEquals(summary.trainingSeconds, 3);
  assertEquals(summary.gainPerSecond, 4 / 3);
});

Deno.test("summarisePolicy - the trimmed mean survives an explosive recovery", () => {
  // Nineteen ordinary events and one creature whose outputs had exploded.
  const gains = [...Array.from({ length: 19 }, () => 0.01), 1e6];
  const summary = summarisePolicy(observations(gains));
  assert(summary.meanGain > 1_000, "the raw mean is the outlier");
  assertAlmostEquals(summary.trimmedMeanGain, 0.01, 1e-12);
  assertEquals(summary.maxGain, 1e6);
  assertAlmostEquals(summary.medianGain, 0.01, 1e-12);
});

Deno.test("summarisePolicy - no events reads as zero, never NaN", () => {
  const summary = summarisePolicy([]);
  assertEquals(summary.events, 0);
  assertEquals(summary.scored, 0);
  assertEquals(summary.meanGain, 0);
  assertEquals(summary.gainPerSecond, 0);
  assert(!Number.isNaN(summary.medianGain));
});

Deno.test("correlateRankAgainstGain - unscored events are excluded", () => {
  const reading = correlateRankAgainstGain(
    observations([0.1, undefined, 0.3, 0.4]),
    11,
  );
  assertEquals(reading.scored, 3);
  assertEquals(reading.distinctRanks, 3);
  assert(
    reading.spearman > 0.9,
    `expected a strong ordering, got ${reading.spearman}`,
  );
});

Deno.test("correlateRankAgainstGain - worse ranks gaining more reads positive", () => {
  // Rank 0 is the fittest creature; it gains least.
  const reading = correlateRankAgainstGain(
    observations([-0.2, -0.1, 0, 0.1, 0.2, 0.3]),
    5,
  );
  assert(reading.spearman > 0.9);
  assert(reading.kendallTauB > 0.9);
});

/** A correlation reading with the fields `stage2Verdict` reads. */
function reading(
  spearmanValue: number,
  pValue: number,
  distinctRanks = 10,
  scored = 500,
) {
  return {
    scored,
    spearman: spearmanValue,
    kendallTauB: spearmanValue * 0.7,
    pValue,
    distinctRanks,
  };
}

Deno.test("stage2Verdict - too few events is undecidable, not a negative", () => {
  const verdict = stage2Verdict(reading(0.9, 0.001), MIN_STAGE1_EVENTS - 1);
  assertEquals(verdict.decision, "undecidable");
  assert(verdict.reason.includes(`${MIN_STAGE1_EVENTS}`));
});

Deno.test("stage2Verdict - a sample covering two ranks orders nothing", () => {
  const verdict = stage2Verdict(reading(0.9, 0.001, 2), 500);
  assertEquals(verdict.decision, "undecidable");
});

Deno.test("stage2Verdict - a significant but immaterial correlation is a no-go", () => {
  const verdict = stage2Verdict(
    reading(STAGE2_MIN_ABS_RHO - 0.01, 0.0001),
    500,
  );
  assertEquals(verdict.decision, "no-go");
  assert(verdict.reason.includes("below the"));
});

Deno.test("stage2Verdict - a large correlation that fails the permutation test is a no-go", () => {
  const verdict = stage2Verdict(reading(0.5, 0.2), 500);
  assertEquals(verdict.decision, "no-go");
  assert(verdict.reason.includes("permutation"));
});

Deno.test("stage2Verdict - material and significant is a go", () => {
  const verdict = stage2Verdict(reading(0.45, 0.0005), 500);
  assertEquals(verdict.decision, "go");
  assert(verdict.reason.includes("orders gain"));
});

Deno.test("stage2Verdict - a strong negative correlation is just as usable", () => {
  // Rank predicting gain downwards is still rank predicting gain.
  assertEquals(stage2Verdict(reading(-0.45, 0.0005), 500).decision, "go");
});
