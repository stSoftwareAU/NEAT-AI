/**
 * Tests for GroupRelativeAdvantage (Issue #2527).
 *
 * Verifies the GRPO advantage transform behaves correctly across the
 * happy path and the edge cases called out in the issue acceptance
 * criteria — single-member, zero-variance, shift invariance.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  computeAdvantageStats,
  computeGroupRelativeAdvantages,
  DEFAULT_ADVANTAGE_CLIP,
  DEFAULT_ADVANTAGE_EPS,
  normaliseDeltaWithCohortStd,
} from "@neat/GroupRelativeAdvantage.ts";
import * as advantageModule from "@neat/GroupRelativeAdvantage.ts";

Deno.test("GRPO advantage: signs match expected ordering for a known cohort", () => {
  // Cohort mean = 3, so 1 and 2 are below average, 4 and 5 above.
  const advantages = computeGroupRelativeAdvantages([1, 2, 3, 4, 5]);
  assertEquals(advantages.length, 5);
  assert(advantages[0] < 0, "below-mean score must have negative advantage");
  assert(advantages[1] < 0, "below-mean score must have negative advantage");
  assertAlmostEquals(advantages[2], 0, 1e-6, "mean score has ~zero advantage");
  assert(advantages[3] > 0, "above-mean score must have positive advantage");
  assert(advantages[4] > 0, "above-mean score must have positive advantage");
  // Symmetric distribution → opposite ends are negatives of each other.
  assertAlmostEquals(advantages[0], -advantages[4], 1e-6);
  assertAlmostEquals(advantages[1], -advantages[3], 1e-6);
});

Deno.test("GRPO advantage: empty cohort returns empty array", () => {
  assertEquals(computeGroupRelativeAdvantages([]), []);
});

Deno.test(
  "GRPO advantage: single-member cohort returns [0] (no signal)",
  () => {
    assertEquals(computeGroupRelativeAdvantages([42]), [0]);
  },
);

Deno.test("GRPO advantage: zero-variance cohort does not divide by zero", () => {
  // All identical scores → std = 0 → every advantage = 0.
  const advantages = computeGroupRelativeAdvantages([7, 7, 7, 7]);
  assertEquals(advantages, [0, 0, 0, 0]);
  for (const a of advantages) {
    assert(Number.isFinite(a), "advantage must be finite when std=0");
  }
});

Deno.test("GRPO advantage: invariant to additive shift of all rewards", () => {
  const base = [1.5, 2.0, 3.5, 4.0, 6.0];
  const shifted = base.map((x) => x + 1000);
  const a1 = computeGroupRelativeAdvantages(base);
  const a2 = computeGroupRelativeAdvantages(shifted);
  assertEquals(a1.length, a2.length);
  for (let i = 0; i < a1.length; i++) {
    assertAlmostEquals(a1[i], a2[i], 1e-9);
  }
});

Deno.test("GRPO advantage: clip bounds the magnitude", () => {
  // One very large outlier; clip to ±2 should bound it.
  const advantages = computeGroupRelativeAdvantages(
    [0, 0, 0, 0, 1_000_000],
    { clip: 2 },
  );
  for (const a of advantages) {
    assert(a >= -2 && a <= 2, `advantage ${a} must be within ±clip`);
  }
  // The outlier must take (or sit just under) the upper clip.
  assertAlmostEquals(advantages[4], 2, 1e-6);
});

Deno.test("GRPO advantage: non-finite scores receive zero advantage", () => {
  const advantages = computeGroupRelativeAdvantages([1, 2, NaN, 3, 4]);
  assertEquals(advantages[2], 0, "NaN score → 0 advantage, never NaN out");
  for (const a of advantages) {
    assert(Number.isFinite(a), "all advantages must be finite");
  }
});

Deno.test("GRPO advantage: default clip is ±10", () => {
  // sanity-check the exported constant matches the docstring.
  assertEquals(DEFAULT_ADVANTAGE_CLIP, 10);
  assert(DEFAULT_ADVANTAGE_EPS > 0 && DEFAULT_ADVANTAGE_EPS < 1e-3);
});

Deno.test(
  "GRPO advantage: DEFAULT_MIN_COHORT_SIZE is not part of the module surface (Issue #3148)",
  () => {
    // The unused export was removed; nothing wires a min-cohort default in.
    assert(
      !("DEFAULT_MIN_COHORT_SIZE" in advantageModule),
      "DEFAULT_MIN_COHORT_SIZE must not be exported — it had no consumer",
    );
  },
);

Deno.test("computeAdvantageStats: skips non-finite entries", () => {
  const stats = computeAdvantageStats([1, NaN, 3, Infinity, 5]);
  assertEquals(stats.count, 3);
  assertAlmostEquals(stats.mean, (1 + 3 + 5) / 3, 1e-9);
});

Deno.test("computeAdvantageStats: zero-length cohort", () => {
  const stats = computeAdvantageStats([]);
  assertEquals(stats, { mean: 0, std: 0, count: 0 });
});

Deno.test("normaliseDeltaWithCohortStd: divides delta by std + eps", () => {
  // delta=2, std=1 → ~2 (eps is tiny).
  const v = normaliseDeltaWithCohortStd(2, 1);
  assertAlmostEquals(v, 2, 1e-6);
});

Deno.test(
  "normaliseDeltaWithCohortStd: zero-std cohort still finite (no divide by zero)",
  () => {
    const v = normaliseDeltaWithCohortStd(2, 0);
    assert(Number.isFinite(v));
  },
);

Deno.test("normaliseDeltaWithCohortStd: clipped symmetrically", () => {
  // huge raw delta on a tiny cohortStd; clip 5 must bound the result.
  const v = normaliseDeltaWithCohortStd(1_000, 0.0001, { clip: 5 });
  assertEquals(v, 5);
  const vNeg = normaliseDeltaWithCohortStd(-1_000, 0.0001, { clip: 5 });
  assertEquals(vNeg, -5);
});

Deno.test(
  "normaliseDeltaWithCohortStd: non-finite delta returns 0",
  () => {
    assertEquals(normaliseDeltaWithCohortStd(NaN, 1), 0);
    assertEquals(normaliseDeltaWithCohortStd(Infinity, 1), 0);
  },
);
