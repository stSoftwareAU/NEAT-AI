/**
 * Whole-run, summed per-backend scorer-utilisation counts returned alongside
 * `phaseTimingTotals` from the `evolve*` functions (Issue #3234).
 *
 * `Fitness.calculate()` already tracks how many `rust_scorer` processes it
 * spawned per generation, but until now the unique-scored creature count was a
 * single number spanning *both* the native batch (one-pass) path and the
 * per-creature worker path — so a silent regression where the batch path broke
 * and every creature quietly fell back to the slow worker path looked
 * identical to a healthy run. These aggregates split that count by backend and
 * so the split is visible in the run result (and therefore in the production
 * run's `result.json`).
 *
 * All values are raw counts summed across every generation of the run.
 *
 * Issue #3866 turned that telemetry into a run-level **verdict** for the window
 * in which a native failure could still degrade to WASM. Issue #3871 deleted
 * the fallback: a `rust_scorer` that is present and fails now aborts the run,
 * so there is no degraded-but-green outcome left to report and the verdict
 * fields are gone with it. What remains is the backend split, which still
 * distinguishes a generation served by the batch scorer from one the
 * eligibility predicate kept on the per-creature worker path.
 */

/**
 * A single generation's scorer-utilisation snapshot, read from `Fitness`
 * after each `evolve()` cycle.
 */
export interface ScorerUtilisationCounts {
  /** `rust_scorer` processes spawned this generation (0 when batch disabled). */
  readonly batchScorerInvocations: number;
  /** Creatures scored via the native batch (one-pass) path this generation. */
  readonly creaturesBatchScored: number;
  /** Creatures scored via the per-creature worker path this generation. */
  readonly creaturesPerCreatureScored: number;
}

/**
 * Whole-run scorer-utilisation totals surfaced on the `evolve*` result beside
 * `phaseTimingTotals`.
 */
export interface ScorerUtilisationTotals {
  /** Number of generations whose scorer counts were aggregated. */
  readonly generations: number;
  /** Total `rust_scorer` processes spawned across the run. */
  readonly batchScorerInvocations: number;
  /** Total creatures scored via the native batch path across the run. */
  readonly creaturesBatchScored: number;
  /** Total creatures scored via the per-creature worker path across the run. */
  readonly creaturesPerCreatureScored: number;
}

/**
 * Mutable running sum of the per-generation scorer counts. Reset to zeros by
 * {@link createScorerUtilisationAccumulator}, advanced one generation at a
 * time by {@link accumulateScorerUtilisation}, and frozen into an immutable
 * {@link ScorerUtilisationTotals} by {@link finaliseScorerUtilisationTotals}.
 */
export interface ScorerUtilisationAccumulator {
  generations: number;
  batchScorerInvocations: number;
  creaturesBatchScored: number;
  creaturesPerCreatureScored: number;
}

/** Create a zeroed {@link ScorerUtilisationAccumulator}. */
export function createScorerUtilisationAccumulator(): ScorerUtilisationAccumulator {
  return {
    generations: 0,
    batchScorerInvocations: 0,
    creaturesBatchScored: 0,
    creaturesPerCreatureScored: 0,
  };
}

/** Add one generation's {@link ScorerUtilisationCounts} into the accumulator. */
export function accumulateScorerUtilisation(
  acc: ScorerUtilisationAccumulator,
  counts: ScorerUtilisationCounts,
): void {
  acc.generations++;
  acc.batchScorerInvocations += counts.batchScorerInvocations;
  acc.creaturesBatchScored += counts.creaturesBatchScored;
  acc.creaturesPerCreatureScored += counts.creaturesPerCreatureScored;
}

/** Freeze the accumulator into an immutable {@link ScorerUtilisationTotals}. */
export function finaliseScorerUtilisationTotals(
  acc: ScorerUtilisationAccumulator,
): ScorerUtilisationTotals {
  return {
    generations: acc.generations,
    batchScorerInvocations: acc.batchScorerInvocations,
    creaturesBatchScored: acc.creaturesBatchScored,
    creaturesPerCreatureScored: acc.creaturesPerCreatureScored,
  };
}
