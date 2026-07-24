/**
 * Milestone summary of the score-improvement curve recorded on the run-level
 * evolve result (Issue #3422).
 *
 * Final score alone is a poor tuning signal because runs plateau (diminishing
 * returns), so a configuration that reaches most of its improvement quickly is
 * more valuable than one that limps to a marginally higher score. To judge that
 * downstream without persisting a large per-generation series, the run records
 * *when* it reached 25/50/75/90% of its total score improvement: the time,
 * generation and cumulative scored-count at each threshold.
 *
 * The summary is computed at run end from a compact in-memory trajectory that
 * only records a point when the best score improves — nothing per-generation is
 * kept or persisted.
 */

/** The improvement fractions summarised, in order. */
export const SCORE_IMPROVEMENT_FRACTIONS: readonly number[] = [
  0.25,
  0.5,
  0.75,
  0.9,
];

/** One point on the best-score trajectory, recorded when the best improves. */
export interface ScoreTrajectoryPoint {
  /** Best score reached at this point. */
  readonly score: number;
  /** Generation number at which the best reached this score. */
  readonly generation: number;
  /** Elapsed run time in ms when the best reached this score. */
  readonly timeMs: number;
  /** Cumulative creatures scored across the run up to this point. */
  readonly scoredCount: number;
}

/** One entry of the finalised improvement-curve summary. */
export interface ScoreImprovementMilestone {
  /** Fraction of total improvement this milestone marks (e.g. `0.25`). */
  readonly fraction: number;
  /** First generation whose best score reached the milestone. */
  readonly generation: number;
  /** Elapsed run time in ms when the milestone was reached. */
  readonly timeMs: number;
  /** Cumulative creatures scored when the milestone was reached. */
  readonly scoredCount: number;
  /** Best score at the milestone (>= the milestone target). */
  readonly score: number;
}

/** Finalised score-improvement summary surfaced on the evolve result. */
export interface ScoreImprovementMilestones {
  /** Best score at the first recorded improvement (the run baseline). */
  readonly initialScore: number;
  /** Best score at run end. */
  readonly finalScore: number;
  /** `finalScore - initialScore`; `0` when the run never improved. */
  readonly totalImprovement: number;
  /**
   * Per-fraction milestones. Empty when there was no positive improvement
   * (e.g. a zero- or one-generation run, or one that never beat its baseline).
   */
  readonly milestones: ScoreImprovementMilestone[];
}

/**
 * Mutable, compact best-score trajectory built up during the run. Only points
 * where the best score improved are appended, so its length is bounded by the
 * number of champions found, not by the generation count.
 */
export interface ScoreTrajectory {
  readonly points: ScoreTrajectoryPoint[];
}

/** Create an empty {@link ScoreTrajectory}. */
export function createScoreTrajectory(): ScoreTrajectory {
  return { points: [] };
}

/**
 * Append a best-score-improvement point. Callers invoke this only when the
 * best score strictly improved, keeping the trajectory compact.
 */
export function recordScoreImprovement(
  trajectory: ScoreTrajectory,
  point: ScoreTrajectoryPoint,
): void {
  trajectory.points.push(point);
}

/**
 * Freeze the trajectory into an immutable {@link ScoreImprovementMilestones}.
 *
 * For each fraction in {@link SCORE_IMPROVEMENT_FRACTIONS} the first trajectory
 * point whose score reached `initialScore + fraction * totalImprovement` is
 * recorded. Milestones are empty when improvement is not positive.
 */
export function finaliseScoreImprovementMilestones(
  trajectory: ScoreTrajectory,
): ScoreImprovementMilestones {
  const points = trajectory.points;
  if (points.length === 0) {
    return {
      initialScore: 0,
      finalScore: 0,
      totalImprovement: 0,
      milestones: [],
    };
  }

  const initialScore = points[0].score;
  const finalScore = points[points.length - 1].score;
  const totalImprovement = finalScore - initialScore;

  const milestones: ScoreImprovementMilestone[] = [];
  if (totalImprovement > 0) {
    for (const fraction of SCORE_IMPROVEMENT_FRACTIONS) {
      const target = initialScore + fraction * totalImprovement;
      const hit = points.find((p) => p.score >= target);
      if (hit) {
        milestones.push({
          fraction,
          generation: hit.generation,
          timeMs: hit.timeMs,
          scoredCount: hit.scoredCount,
          score: hit.score,
        });
      }
    }
  }

  return { initialScore, finalScore, totalImprovement, milestones };
}
