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
 * add an explicit batch-fallback tally so the split is visible in the run
 * result (and therefore in the GRQ-cluster `result.json`).
 *
 * All values are raw counts summed across every generation of the run.
 */

/**
 * A single generation's scorer-utilisation snapshot, read from `Fitness`
 * after each `evolve()` cycle. `batchFallbackOccurred` is a boolean because a
 * generation either did or did not revert its whole batch to the worker path;
 * the accumulator turns it into a per-run count of affected generations.
 */
export interface ScorerUtilisationCounts {
  /** `rust_scorer` processes spawned this generation (0 when batch disabled). */
  readonly batchScorerInvocations: number;
  /** Creatures scored via the native batch (one-pass) path this generation. */
  readonly creaturesBatchScored: number;
  /** Creatures scored via the per-creature worker path this generation. */
  readonly creaturesPerCreatureScored: number;
  /**
   * True when a batch attempt failed this generation and its creatures
   * reverted to the per-creature worker path. A partial/whole fallback must be
   * visible, not masked as success.
   */
  readonly batchFallbackOccurred: boolean;
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
  /**
   * Number of generations that hit a batch fallback. Non-zero means the native
   * batch path failed at least once and scoring silently continued on the slow
   * worker path — exactly the regression this telemetry exists to expose.
   */
  readonly batchFallbackGenerations: number;
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
  batchFallbackGenerations: number;
}

/** Create a zeroed {@link ScorerUtilisationAccumulator}. */
export function createScorerUtilisationAccumulator(): ScorerUtilisationAccumulator {
  return {
    generations: 0,
    batchScorerInvocations: 0,
    creaturesBatchScored: 0,
    creaturesPerCreatureScored: 0,
    batchFallbackGenerations: 0,
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
  if (counts.batchFallbackOccurred) acc.batchFallbackGenerations++;
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
    batchFallbackGenerations: acc.batchFallbackGenerations,
  };
}
