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
 * result (and therefore in the production run's `result.json`).
 *
 * All values are raw counts summed across every generation of the run.
 *
 * Issue #3866 turns the telemetry into a **verdict**. The per-generation flags
 * are reset every generation, so a run that degraded in every generation but
 * recovered in each one still finished green. `nativeFallbackGenerations` and
 * the `nativeScoringFallback` boolean are the run-level aggregate that survives
 * that reset, and they cover the per-creature `rust_scorer` path as well as the
 * batch catch. Under the default `NEAT_AI_RUST_SCORER_STRICT=1` a degradation
 * throws and never reaches here; with the operator's explicit
 * `NEAT_AI_RUST_SCORER_STRICT=0` opt-out the run completes and the verdict is
 * handed to the caller instead of the library unilaterally failing the run.
 */

import { getLogger } from "@utils/Logger.ts";

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
  /**
   * True when **any** native scoring attempt degraded to WASM this generation
   * (Issue #3866) — the batch catch above, or a per-creature `rust_scorer`
   * failure reported by an evaluation worker.
   *
   * A superset of {@link batchFallbackOccurred}, and optional so scorers that
   * never touch the native path (episodic / RL) need not publish it; when it is
   * omitted a `batchFallbackOccurred` still counts as a native fallback.
   */
  readonly nativeFallbackOccurred?: boolean;
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
  /**
   * Number of generations in which native scoring degraded to WASM — the batch
   * catch **or** the per-creature `rust_scorer` path (Issue #3866). The batch
   * count above sees only the former, so a run whose every creature quietly
   * scored on WASM reported zero there.
   */
  readonly nativeFallbackGenerations: number;
  /**
   * The run-level verdict (Issue #3866): `true` when native scoring degraded at
   * least once during the run. Equivalent to
   * `nativeFallbackGenerations > 0`, named so a caller can act on it directly —
   * under `NEAT_AI_RUST_SCORER_STRICT=0` the library completes the run rather
   * than revoking the operator's explicit opt-out, and hands the decision back
   * here. Under the default strict mode the run throws instead and never
   * reaches this field.
   */
  readonly nativeScoringFallback: boolean;
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
  nativeFallbackGenerations: number;
}

/** Create a zeroed {@link ScorerUtilisationAccumulator}. */
export function createScorerUtilisationAccumulator(): ScorerUtilisationAccumulator {
  return {
    generations: 0,
    batchScorerInvocations: 0,
    creaturesBatchScored: 0,
    creaturesPerCreatureScored: 0,
    batchFallbackGenerations: 0,
    nativeFallbackGenerations: 0,
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
  // Issue #3866: a batch fallback is always a native fallback; the per-creature
  // path adds the cases the batch flag cannot see.
  if (counts.batchFallbackOccurred || counts.nativeFallbackOccurred === true) {
    acc.nativeFallbackGenerations++;
  }
}

/**
 * Freeze the accumulator into an immutable {@link ScorerUtilisationTotals}.
 *
 * Issue #3866: this is the single run-end choke point every `evolve*` loop
 * passes through, so a set verdict is logged **once** here as an error. The
 * per-occurrence warnings are what got buried in #3810 — one summary line at
 * run end is what an operator actually reads.
 */
export function finaliseScorerUtilisationTotals(
  acc: ScorerUtilisationAccumulator,
): ScorerUtilisationTotals {
  if (acc.nativeFallbackGenerations > 0) {
    getLogger().error(
      `[NEAT-AI] Native scoring degraded to WASM in ` +
        `${acc.nativeFallbackGenerations} of ${acc.generations} generation(s); ` +
        `this run did NOT score on the native path. ` +
        `Result field: scorerUtilisation.nativeScoringFallback=true.`,
    );
  }
  return {
    generations: acc.generations,
    batchScorerInvocations: acc.batchScorerInvocations,
    creaturesBatchScored: acc.creaturesBatchScored,
    creaturesPerCreatureScored: acc.creaturesPerCreatureScored,
    batchFallbackGenerations: acc.batchFallbackGenerations,
    nativeFallbackGenerations: acc.nativeFallbackGenerations,
    nativeScoringFallback: acc.nativeFallbackGenerations > 0,
  };
}
