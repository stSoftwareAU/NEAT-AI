import type { GenerationPhaseTiming } from "../config/TrainingEvent.ts";

/**
 * Whole-run, summed per-phase timing totals returned alongside the single
 * total `time` from the `evolve*` functions (Issue #3210).
 *
 * The per-generation {@link GenerationPhaseTiming} breakdown is already
 * recorded by `neat.evolve()` and streamed on every `generation_complete`
 * training event. This aggregate simply sums those always-on measurements
 * across the whole run so a caller can confirm — without wiring up an
 * `onTrainingEvent` listener — where the bulk of the time went (typically
 * fitness/scoring when scanning large training data) and spot any phase worth
 * tuning. All values are raw milliseconds; percentages are the caller's to
 * derive.
 *
 * Scope is deliberately the *major* phases only (no breeding sub-phase
 * totals). The `otherMs` bucket captures wall-clock not attributed to a named
 * phase — worker start-up, population seeding, finish-up waits, the final
 * checkpoint write and any phase overlap — so the buckets reconcile against
 * the run's total `time`:
 *
 *   fitnessMs + breedingMs + mutationMs + deduplicationMs + speciationMs +
 *   sortMs + writeScoresMs + checkpointWriteMs + otherMs === totalMs
 */
export interface PhaseTimingTotals {
  /** Number of generations whose phase timings were aggregated. */
  readonly generations: number;
  /** Total run time in ms — equal to the returned `time`. */
  readonly totalMs: number;
  /** Summed fitness/scoring time across all generations in ms. */
  readonly fitnessMs: number;
  /** Summed breeding time across all generations in ms. */
  readonly breedingMs: number;
  /** Summed mutation time across all generations in ms. */
  readonly mutationMs: number;
  /** Summed de-duplication time across all generations in ms. */
  readonly deduplicationMs: number;
  /** Summed speciation time across all generations in ms. */
  readonly speciationMs: number;
  /** Summed sort time across all generations in ms. */
  readonly sortMs: number;
  /** Summed score-file write time across all generations in ms. */
  readonly writeScoresMs: number;
  /** Summed checkpoint-write time across all generations in ms. */
  readonly checkpointWriteMs: number;
  /**
   * Wall-clock not attributed to a named phase in ms — worker start-up,
   * population seeding, finish-up waits, the final checkpoint write and any
   * phase overlap. Clamped at 0: when pipelined phases overlap, the summed
   * named phases can exceed wall-clock, in which case this reads 0.
   */
  readonly otherMs: number;
}

/**
 * Mutable running sum of the major per-generation phases. Reset to zeros by
 * {@link createPhaseTimingAccumulator} and advanced one generation at a time
 * by {@link accumulatePhaseTiming}. Finalised into an immutable
 * {@link PhaseTimingTotals} by {@link finalisePhaseTimingTotals}.
 */
export interface PhaseTimingAccumulator {
  generations: number;
  fitnessMs: number;
  breedingMs: number;
  mutationMs: number;
  deduplicationMs: number;
  speciationMs: number;
  sortMs: number;
  writeScoresMs: number;
  checkpointWriteMs: number;
}

/** Create a zeroed {@link PhaseTimingAccumulator}. */
export function createPhaseTimingAccumulator(): PhaseTimingAccumulator {
  return {
    generations: 0,
    fitnessMs: 0,
    breedingMs: 0,
    mutationMs: 0,
    deduplicationMs: 0,
    speciationMs: 0,
    sortMs: 0,
    writeScoresMs: 0,
    checkpointWriteMs: 0,
  };
}

/**
 * Add one generation's {@link GenerationPhaseTiming} into the accumulator.
 * Optional per-generation phases (mutation, dedup, speciation, sort,
 * writeScores, checkpoint) contribute 0 when absent.
 */
export function accumulatePhaseTiming(
  acc: PhaseTimingAccumulator,
  timing: GenerationPhaseTiming,
): void {
  acc.generations++;
  acc.fitnessMs += timing.fitnessMs;
  acc.breedingMs += timing.breedingMs;
  acc.mutationMs += timing.mutationMs ?? 0;
  acc.deduplicationMs += timing.deduplicationMs ?? 0;
  acc.speciationMs += timing.speciationMs ?? 0;
  acc.sortMs += timing.sortMs ?? 0;
  acc.writeScoresMs += timing.writeScoresMs ?? 0;
  acc.checkpointWriteMs += timing.checkpointWriteMs ?? 0;
}

/**
 * Freeze the accumulator into an immutable {@link PhaseTimingTotals}, deriving
 * the `otherMs` reconciliation bucket from the run's total wall-clock time.
 *
 * @param acc The accumulated per-phase sums.
 * @param runTotalMs The whole-run wall-clock time in ms (the returned `time`).
 */
export function finalisePhaseTimingTotals(
  acc: PhaseTimingAccumulator,
  runTotalMs: number,
): PhaseTimingTotals {
  const accounted = acc.fitnessMs + acc.breedingMs + acc.mutationMs +
    acc.deduplicationMs + acc.speciationMs + acc.sortMs + acc.writeScoresMs +
    acc.checkpointWriteMs;
  // Follow the codebase convention (see nonFitnessMs) of clamping the
  // wall-clock residual at 0 so overlapping/pipelined phases never yield a
  // negative "other" bucket.
  const otherMs = Math.max(0, runTotalMs - accounted);
  return {
    generations: acc.generations,
    totalMs: runTotalMs,
    fitnessMs: acc.fitnessMs,
    breedingMs: acc.breedingMs,
    mutationMs: acc.mutationMs,
    deduplicationMs: acc.deduplicationMs,
    speciationMs: acc.speciationMs,
    sortMs: acc.sortMs,
    writeScoresMs: acc.writeScoresMs,
    checkpointWriteMs: acc.checkpointWriteMs,
    otherMs,
  };
}
