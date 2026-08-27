/**
 * Issue #3909 — rank-based fitness shaping (Salimans et al. 2017).
 *
 * These tests pin the two properties the transform exists to provide:
 * invariance to the scale of the objective, and immunity to a single
 * outlier dominating the cohort.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  centredRanks,
  DEFAULT_RANK_SHAPING_WINDOW,
  rankQuantile,
  rankShapedDelta,
  RankShapingWindow,
} from "@neat/RankShaping.ts";
import { metropolisHastingsAccept } from "@neat/MetropolisHastings.ts";

// ------------------------------------------------------------ centredRanks

Deno.test("centredRanks - spans [-0.5, +0.5] in ascending order", () => {
  assertEquals(centredRanks([10, 20, 30, 40, 50]), [
    -0.5,
    -0.25,
    0,
    0.25,
    0.5,
  ]);
});

Deno.test("centredRanks - depends only on order, not magnitude", () => {
  // One freak score cannot move anybody else's shaped value.
  assertEquals(centredRanks([1, 2, 3, 4, 1e9]), centredRanks([1, 2, 3, 4, 5]));
  // Nor can an affine rescaling of the whole cohort.
  assertEquals(
    centredRanks([1, 2, 3, 4, 5].map((v) => v * 1000 + 7)),
    centredRanks([1, 2, 3, 4, 5]),
  );
});

Deno.test("centredRanks - sums to zero", () => {
  const sum = centredRanks([3, 9, -2, 7, 7, 0]).reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, 0, 1e-12);
});

Deno.test("centredRanks - ties share the averaged rank", () => {
  // Ranks 1 and 2 of 4 are tied, so both take the midpoint of their span.
  assertEquals(centredRanks([1, 5, 5, 9]), [-0.5, 0, 0, 0.5]);
});

Deno.test("centredRanks - degenerate cohorts stay finite", () => {
  assertEquals(centredRanks([]), []);
  assertEquals(centredRanks([42]), [0]);
  assertEquals(centredRanks([7, 7, 7]), [0, 0, 0]);
});

Deno.test("centredRanks - non-finite entries score zero and do not rank", () => {
  const out = centredRanks([1, NaN, 3, Infinity, 5]);
  assertEquals(out[1], 0);
  assertEquals(out[3], 0);
  // The three finite entries still span the full range between themselves.
  assertEquals([out[0], out[2], out[4]], [-0.5, 0, 0.5]);
});

// ----------------------------------------------------------- rankQuantile

Deno.test("rankQuantile - empty reference is a flat 0.5", () => {
  assertEquals(rankQuantile(3, []), 0.5);
  assertEquals(rankQuantile(3, [NaN, Infinity]), 0.5);
});

Deno.test("rankQuantile - stays strictly inside (0, 1)", () => {
  const reference = [1, 2, 3, 4];
  const low = rankQuantile(-100, reference);
  const high = rankQuantile(100, reference);
  assert(low > 0 && low < 0.5, `expected (0, 0.5), got ${low}`);
  assert(high > 0.5 && high < 1, `expected (0.5, 1), got ${high}`);
});

Deno.test("rankQuantile - a value at the cohort median sits near 0.5", () => {
  assertAlmostEquals(rankQuantile(3, [1, 2, 3, 4, 5]), 0.5833, 1e-3);
  assertAlmostEquals(rankQuantile(1, [1, 2, 3, 4, 5]), 0.25, 1e-12);
});

Deno.test("rankQuantile - non-finite value is treated as no information", () => {
  assertEquals(rankQuantile(NaN, [1, 2, 3]), 0.5);
});

// --------------------------------------------------------- rankShapedDelta

Deno.test("rankShapedDelta - improving and neutral deltas pass through unchanged", () => {
  // The M-H invariant: a strict improvement is never rejected.
  assertEquals(rankShapedDelta(-0.25, [0.1, 0.2, 0.3]), -0.25);
  assertEquals(rankShapedDelta(0, [0.1, 0.2, 0.3]), 0);
});

Deno.test("rankShapedDelta - worsening deltas rank only against worsening history", () => {
  // The three negatives must not push the candidate to the top.
  const withImproving = rankShapedDelta(0.2, [-5, -4, -3, 0.1, 0.3]);
  const worseningOnly = rankShapedDelta(0.2, [0.1, 0.3]);
  assertEquals(withImproving, worseningOnly);
  assertAlmostEquals(worseningOnly, (1 + 0.5) / 3, 1e-12);
});

Deno.test("rankShapedDelta - scaling every cost leaves the shaped delta identical", () => {
  const reference = [0.01, 0.04, 0.09, 0.16];
  const candidate = 0.05;
  const scale = 1_000_000;
  assertEquals(
    rankShapedDelta(candidate * scale, reference.map((r) => r * scale)),
    rankShapedDelta(candidate, reference),
  );
});

Deno.test("rankShapedDelta - a converged cohort still produces a spread of quantiles", () => {
  // As the population converges the raw deltas collapse toward zero. Absolute
  // mode would accept essentially everything; the shaped delta keeps ranking.
  const collapsed = [1e-9, 2e-9, 3e-9, 4e-9];
  const small = rankShapedDelta(5e-10, collapsed);
  const large = rankShapedDelta(5e-9, collapsed);
  assert(small < 0.3, `expected a low quantile, got ${small}`);
  assert(large > 0.7, `expected a high quantile, got ${large}`);
});

Deno.test("rankShapedDelta - one outlier cannot swamp the ordering", () => {
  const reference = [0.1, 0.2, 0.3, 1e9];
  assertAlmostEquals(rankShapedDelta(0.25, reference), (2 + 0.5) / 5, 1e-12);
});

Deno.test("rankShapedDelta - non-finite delta yields no signal", () => {
  assertEquals(rankShapedDelta(NaN, [0.1, 0.2]), 0);
});

// ------------------------------------------------------ acceptance coupling

Deno.test("rankShapedDelta - acceptance is invariant to cost-function rescaling", () => {
  // The behavioural claim in the issue: the same temperature means the same
  // thing whatever the numeric scale of the objective.
  const reference = [0.01, 0.02, 0.03, 0.04, 0.05];
  const candidate = 0.035;
  const temperature = 0.4;
  const randomValue = 0.5;

  const base = metropolisHastingsAccept(
    rankShapedDelta(candidate, reference),
    temperature,
    randomValue,
  );
  for (const scale of [1e-6, 1e3, 1e9]) {
    assertEquals(
      metropolisHastingsAccept(
        rankShapedDelta(candidate * scale, reference.map((r) => r * scale)),
        temperature,
        randomValue,
      ),
      base,
      `acceptance changed at scale ${scale}`,
    );
  }
});

// ------------------------------------------------------ RankShapingWindow

Deno.test("RankShapingWindow - empty window gives every worsening move 0.5", () => {
  const window = new RankShapingWindow(8);
  assertEquals(window.size, 0);
  assertEquals(window.shape(1.5), 0.5);
  assertEquals(window.shape(1e-12), 0.5);
});

Deno.test("RankShapingWindow - shape() does not record the candidate", () => {
  const window = new RankShapingWindow(8);
  window.shape(0.5);
  assertEquals(window.size, 0);
});

Deno.test("RankShapingWindow - ranks against recorded history", () => {
  const window = new RankShapingWindow(8);
  for (const d of [0.1, 0.2, 0.3, 0.4]) window.record(d);
  assertEquals(window.size, 4);
  assertAlmostEquals(window.shape(0.25), (2 + 0.5) / 5, 1e-12);
  assertEquals(window.shape(-1), -1);
});

Deno.test("RankShapingWindow - evicts oldest entries at capacity", () => {
  const window = new RankShapingWindow(3);
  for (const d of [10, 11, 12, 0.1, 0.2]) window.record(d);
  assertEquals(window.size, 3);
  // Only 0.1, 0.2 and 12 remain — the two oldest were evicted — so 0.15
  // sits above exactly one of the three.
  assertAlmostEquals(window.shape(0.15), (1 + 0.5) / 4, 1e-12);
});

Deno.test("RankShapingWindow - non-finite deltas are not recorded", () => {
  const window = new RankShapingWindow(4);
  window.record(NaN);
  window.record(Infinity);
  assertEquals(window.size, 0);
});

Deno.test("RankShapingWindow - reset empties the reference", () => {
  const window = new RankShapingWindow(4);
  window.record(0.1);
  window.record(0.2);
  window.reset();
  assertEquals(window.size, 0);
  assertEquals(window.shape(0.15), 0.5);
});

Deno.test("RankShapingWindow - invalid capacity falls back to the default", () => {
  const window = new RankShapingWindow(0);
  for (let i = 0; i < DEFAULT_RANK_SHAPING_WINDOW + 10; i++) {
    window.record(i + 1);
  }
  assertEquals(window.size, DEFAULT_RANK_SHAPING_WINDOW);
});
