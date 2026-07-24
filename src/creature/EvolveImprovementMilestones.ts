/**
 * EvolveImprovementMilestones.ts — compact score-improvement milestone summary
 * for the run-level evolve result (Issue #3422).
 *
 * Judging which hardware/configuration gives the best *rate* of score
 * improvement needs more than the final score — runs plateau, so the final
 * number alone hides how quickly a configuration climbed. This module keeps a
 * tiny in-memory trajectory of best-score improvements during a run (one point
 * per genuine improvement, not per generation) and, at run end, reduces it to
 * the generation / elapsed time / creatures-scored at which the run reached
 * 25/50/75/90% of its *total* improvement. No per-generation series is
 * persisted — the user explicitly does not want a large JSON.
 */

/**
 * A single best-score improvement recorded during a run. `scoredCount` is the
 * cumulative number of creatures actually scored (the "variants checked" count)
 * up to and including the generation that produced this improvement.
 */
export interface ImprovementPoint {
  readonly score: number;
  readonly generation: number;
  readonly timeMs: number;
  readonly scoredCount: number;
}

/**
 * One milestone on the score-improvement curve: the first trajectory point at
 * which the run reached `fraction` of its total improvement.
 */
export interface ImprovementMilestone {
  /** Fraction of total improvement reached (0.25 | 0.5 | 0.75 | 0.9). */
  readonly fraction: number;
  readonly score: number;
  readonly generation: number;
  readonly timeMs: number;
  readonly scoredCount: number;
}

/**
 * Whole-run summary of the score-improvement curve surfaced on the evolve
 * result. `milestones` is empty when the run produced no positive improvement
 * (a single best score, or a flat run).
 */
export interface ImprovementSummary {
  /** Best score at the first recorded improvement (the curve's baseline). */
  readonly firstScore: number;
  /** Best score at run end. */
  readonly finalScore: number;
  /** `finalScore - firstScore`; zero or negative means no net improvement. */
  readonly totalImprovement: number;
  readonly milestones: readonly ImprovementMilestone[];
}

/** Milestone fractions of total improvement recorded on every run. */
export const IMPROVEMENT_MILESTONE_FRACTIONS = [0.25, 0.5, 0.75, 0.9] as const;

/**
 * Mutable trajectory of best-score improvements. Created empty, appended to via
 * {@link recordImprovement} whenever the champion improves, and reduced to an
 * immutable {@link ImprovementSummary} by {@link summariseImprovement}.
 */
export interface ImprovementTracker {
  readonly points: ImprovementPoint[];
}

/** Create an empty {@link ImprovementTracker}. */
export function createImprovementTracker(): ImprovementTracker {
  return { points: [] };
}

/**
 * Append a genuine improvement to the trajectory. Points whose score does not
 * strictly exceed the previous best are ignored, keeping the trajectory
 * monotonically increasing so milestone bucketing is well defined.
 */
export function recordImprovement(
  tracker: ImprovementTracker,
  point: ImprovementPoint,
): void {
  const points = tracker.points;
  const last = points[points.length - 1];
  if (last !== undefined && point.score <= last.score) return;
  points.push(point);
}

/**
 * Reduce the trajectory to the run-level {@link ImprovementSummary}. For each
 * milestone fraction the summary records the first trajectory point whose score
 * reached `firstScore + fraction * totalImprovement`.
 */
export function summariseImprovement(
  tracker: ImprovementTracker,
): ImprovementSummary {
  const points = tracker.points;
  if (points.length === 0) {
    return {
      firstScore: 0,
      finalScore: 0,
      totalImprovement: 0,
      milestones: [],
    };
  }

  const firstScore = points[0].score;
  const finalScore = points[points.length - 1].score;
  const totalImprovement = finalScore - firstScore;

  const milestones: ImprovementMilestone[] = [];
  if (totalImprovement > 0) {
    for (const fraction of IMPROVEMENT_MILESTONE_FRACTIONS) {
      const target = firstScore + fraction * totalImprovement;
      const point = points.find((p) => p.score >= target);
      if (point !== undefined) {
        milestones.push({
          fraction,
          score: point.score,
          generation: point.generation,
          timeMs: point.timeMs,
          scoredCount: point.scoredCount,
        });
      }
    }
  }

  return { firstScore, finalScore, totalImprovement, milestones };
}
