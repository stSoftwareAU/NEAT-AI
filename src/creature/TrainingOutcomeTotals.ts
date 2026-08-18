/**
 * Run-level training-outcome totals recorded on every `evolve*` result
 * (Issue #3779).
 *
 * The per-skip log line is `verbose`-only, so a consumer's run-end summary had
 * no way to see how many training dispatches were skipped — or how many of the
 * dispatches that did run bought nothing. These totals put that on the result
 * object, where they can be printed regardless of log level.
 */

import type { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";

/** Whole-run training-outcome counters (Issue #3779). */
export interface TrainingOutcomeTotals {
  /** Training results that materially lowered the error, or fine-tuned well. */
  readonly improvements: number;
  /** Training results that were rolled back for a materially higher error. */
  readonly regressions: number;
  /** Training results inside the noise floor — no material change. */
  readonly noChange: number;
  /** Training dispatches skipped by the no-progress guards. */
  readonly skipped: number;
  /** Regressions as a fraction of all recorded outcomes (0 when none). */
  readonly regressionRate: number;
}

/** Snapshot the tracker's aggregate counters for the `evolve*` result. */
export function summariseTrainingOutcomes(
  tracker: TrainingRegressionTracker,
): TrainingOutcomeTotals {
  return {
    improvements: tracker.totalImprovements,
    regressions: tracker.totalRegressions,
    noChange: tracker.totalNoChange,
    skipped: tracker.totalSkipped,
    regressionRate: tracker.regressionRate(),
  };
}
