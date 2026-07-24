/**
 * Unit tests for the score-improvement milestone summary (Issue #3422): the
 * compact best-score trajectory kept during a run is frozen into 25/50/75/90%
 * milestones recording the time, generation and cumulative scored-count at
 * which each fraction of the total improvement was reached.
 */

import { assertEquals } from "@std/assert";
import {
  createScoreTrajectory,
  finaliseScoreImprovementMilestones,
  recordScoreImprovement,
  SCORE_IMPROVEMENT_FRACTIONS,
} from "@creature/ScoreImprovementMilestones.ts";

Deno.test("finaliseScoreImprovementMilestones - empty trajectory yields zeros", () => {
  const result = finaliseScoreImprovementMilestones(createScoreTrajectory());
  assertEquals(result.initialScore, 0);
  assertEquals(result.finalScore, 0);
  assertEquals(result.totalImprovement, 0);
  assertEquals(result.milestones, []);
});

Deno.test("finaliseScoreImprovementMilestones - single point has no improvement", () => {
  const trajectory = createScoreTrajectory();
  recordScoreImprovement(trajectory, {
    score: 0.4,
    generation: 1,
    timeMs: 10,
    scoredCount: 5,
  });

  const result = finaliseScoreImprovementMilestones(trajectory);
  assertEquals(result.initialScore, 0.4);
  assertEquals(result.finalScore, 0.4);
  assertEquals(result.totalImprovement, 0);
  assertEquals(result.milestones, []);
});

Deno.test("finaliseScoreImprovementMilestones - records first point reaching each fraction", () => {
  const trajectory = createScoreTrajectory();
  // Baseline 0.0 → final 1.0, so total improvement is 1.0 and the fraction
  // targets are exactly 0.25/0.5/0.75/0.9.
  const points = [
    { score: 0.0, generation: 1, timeMs: 100, scoredCount: 10 },
    { score: 0.3, generation: 2, timeMs: 200, scoredCount: 20 }, // >= 0.25
    { score: 0.6, generation: 4, timeMs: 400, scoredCount: 40 }, // >= 0.5
    { score: 0.8, generation: 6, timeMs: 600, scoredCount: 60 }, // >= 0.75
    { score: 1.0, generation: 9, timeMs: 900, scoredCount: 90 }, // >= 0.9
  ];
  for (const p of points) recordScoreImprovement(trajectory, p);

  const result = finaliseScoreImprovementMilestones(trajectory);
  assertEquals(result.initialScore, 0.0);
  assertEquals(result.finalScore, 1.0);
  assertEquals(result.totalImprovement, 1.0);
  assertEquals(result.milestones.length, SCORE_IMPROVEMENT_FRACTIONS.length);

  assertEquals(result.milestones[0], {
    fraction: 0.25,
    generation: 2,
    timeMs: 200,
    scoredCount: 20,
    score: 0.3,
  });
  assertEquals(result.milestones[1].fraction, 0.5);
  assertEquals(result.milestones[1].generation, 4);
  assertEquals(result.milestones[2].fraction, 0.75);
  assertEquals(result.milestones[2].generation, 6);
  assertEquals(result.milestones[3].fraction, 0.9);
  assertEquals(result.milestones[3].generation, 9);
});

Deno.test("finaliseScoreImprovementMilestones - one big jump satisfies every fraction", () => {
  const trajectory = createScoreTrajectory();
  recordScoreImprovement(trajectory, {
    score: 0.1,
    generation: 1,
    timeMs: 50,
    scoredCount: 5,
  });
  // A single leap straight to the top: every fraction target is met by the
  // same generation.
  recordScoreImprovement(trajectory, {
    score: 0.9,
    generation: 2,
    timeMs: 120,
    scoredCount: 12,
  });

  const result = finaliseScoreImprovementMilestones(trajectory);
  assertEquals(result.milestones.length, SCORE_IMPROVEMENT_FRACTIONS.length);
  for (const milestone of result.milestones) {
    assertEquals(milestone.generation, 2);
    assertEquals(milestone.timeMs, 120);
    assertEquals(milestone.scoredCount, 12);
    assertEquals(milestone.score, 0.9);
  }
});
