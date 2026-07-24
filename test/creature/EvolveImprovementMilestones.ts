/**
 * Unit tests for the score-improvement milestone summary (Issue #3422).
 *
 * The tracker keeps a compact in-memory trajectory of best-score improvements
 * during a run; `summariseImprovement` reduces that trajectory to the
 * generation / time / scored-count at which the run reached 25/50/75/90% of its
 * total score improvement. These are "what" tests — they exercise the real
 * reducer with representative trajectories and assert on the summary values.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createImprovementTracker,
  IMPROVEMENT_MILESTONE_FRACTIONS,
  recordImprovement,
  summariseImprovement,
} from "@creature/EvolveImprovementMilestones.ts";

Deno.test("summariseImprovement - empty trajectory yields zeroed summary", () => {
  const tracker = createImprovementTracker();
  const summary = summariseImprovement(tracker);
  assertEquals(summary.firstScore, 0);
  assertEquals(summary.finalScore, 0);
  assertEquals(summary.totalImprovement, 0);
  assertEquals(summary.milestones.length, 0);
});

Deno.test("summariseImprovement - single improvement has no milestones", () => {
  const tracker = createImprovementTracker();
  recordImprovement(tracker, {
    score: 0.4,
    generation: 1,
    timeMs: 100,
    scoredCount: 10,
  });
  const summary = summariseImprovement(tracker);
  assertEquals(summary.firstScore, 0.4);
  assertEquals(summary.finalScore, 0.4);
  assertEquals(summary.totalImprovement, 0);
  // No positive total improvement → nothing to bucket.
  assertEquals(summary.milestones.length, 0);
});

Deno.test("summariseImprovement - buckets a linear improvement curve", () => {
  const tracker = createImprovementTracker();
  // Baseline 0.0 rising to 1.0 in 0.1 steps; scored count and time rise too.
  for (let gen = 1; gen <= 11; gen++) {
    recordImprovement(tracker, {
      score: (gen - 1) * 0.1,
      generation: gen,
      timeMs: gen * 1000,
      scoredCount: gen * 100,
    });
  }
  const summary = summariseImprovement(tracker);
  assertEquals(summary.firstScore, 0);
  assertAlmostEquals(summary.finalScore, 1.0, 1e-9);
  assertAlmostEquals(summary.totalImprovement, 1.0, 1e-9);

  // Milestones at 25/50/75/90% of a 0→1 curve: first point >= target.
  assertEquals(
    summary.milestones.map((m) => m.fraction),
    [...IMPROVEMENT_MILESTONE_FRACTIONS],
  );

  const byFraction = new Map(summary.milestones.map((m) => [m.fraction, m]));
  // target 0.25 → first score >= 0.25 is 0.3 (generation 4).
  assertEquals(byFraction.get(0.25)?.generation, 4);
  // target 0.50 → first score >= 0.50 is 0.5 (generation 6).
  assertEquals(byFraction.get(0.5)?.generation, 6);
  // target 0.75 → first score >= 0.75 is 0.8 (generation 9).
  assertEquals(byFraction.get(0.75)?.generation, 9);
  // target 0.90 → first score >= 0.90 is 0.9 (generation 10).
  assertEquals(byFraction.get(0.9)?.generation, 10);

  // Each milestone carries the trajectory point's time and scored count.
  assertEquals(byFraction.get(0.5)?.timeMs, 6000);
  assertEquals(byFraction.get(0.5)?.scoredCount, 600);
});

Deno.test("recordImprovement - ignores non-improving points to stay monotonic", () => {
  const tracker = createImprovementTracker();
  recordImprovement(tracker, {
    score: 0.5,
    generation: 1,
    timeMs: 10,
    scoredCount: 5,
  });
  // Equal and lower scores are rejected.
  recordImprovement(tracker, {
    score: 0.5,
    generation: 2,
    timeMs: 20,
    scoredCount: 10,
  });
  recordImprovement(tracker, {
    score: 0.3,
    generation: 3,
    timeMs: 30,
    scoredCount: 15,
  });
  recordImprovement(tracker, {
    score: 0.9,
    generation: 4,
    timeMs: 40,
    scoredCount: 20,
  });
  const summary = summariseImprovement(tracker);
  assertEquals(summary.firstScore, 0.5);
  assertEquals(summary.finalScore, 0.9);
  // Only the two genuine improvements were retained.
  assert(summary.totalImprovement > 0);
});

Deno.test("summariseImprovement - handles negative baseline (RL rewards)", () => {
  const tracker = createImprovementTracker();
  recordImprovement(tracker, {
    score: -100,
    generation: 1,
    timeMs: 100,
    scoredCount: 50,
  });
  recordImprovement(tracker, {
    score: -50,
    generation: 5,
    timeMs: 500,
    scoredCount: 250,
  });
  recordImprovement(tracker, {
    score: 0,
    generation: 10,
    timeMs: 1000,
    scoredCount: 500,
  });
  const summary = summariseImprovement(tracker);
  assertEquals(summary.firstScore, -100);
  assertEquals(summary.finalScore, 0);
  assertEquals(summary.totalImprovement, 100);
  // 50% of a -100→0 curve is -50, reached at generation 5.
  const half = summary.milestones.find((m) => m.fraction === 0.5);
  assertEquals(half?.generation, 5);
  assertEquals(half?.score, -50);
});
