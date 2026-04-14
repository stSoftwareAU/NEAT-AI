/**
 * BreedingSubPhaseAccumulator.ts — Mutable accumulator for breeding sub-phase timing.
 *
 * Issue #2284: Collects sub-phase timing from individual `Offspring.breed()` calls
 * and parent selection in `ParallelBreeding.breedBatch()`, then freezes the result
 * into a `BreedingSubPhaseTiming` snapshot for the training event.
 *
 * Thread safety: This accumulator is only used on the main thread (non-worker path).
 * The microtask-based `Promise.all` in `breedBatch()` runs sequentially on the
 * main thread, so concurrent mutation is not possible.
 */

import type { BreedingSubPhaseTiming } from "@config/TrainingEvent.ts";

/**
 * Mutable accumulator that aggregates sub-phase timing across all offspring
 * bred in a single generation.
 */
export class BreedingSubPhaseAccumulator {
  parentSelectionMs = 0;
  geneticCompatibilityMs = 0;
  alignmentCrossoverMs = 0;
  sortNeuronsMs = 0;
  batchConnectionMs = 0;
  postBreedingRepairMs = 0;
  offspringCount = 0;

  /**
   * Freeze the accumulated timings into an immutable snapshot.
   */
  toTiming(): BreedingSubPhaseTiming {
    return Object.freeze({
      parentSelectionMs: this.parentSelectionMs,
      geneticCompatibilityMs: this.geneticCompatibilityMs,
      alignmentCrossoverMs: this.alignmentCrossoverMs,
      sortNeuronsMs: this.sortNeuronsMs,
      batchConnectionMs: this.batchConnectionMs,
      postBreedingRepairMs: this.postBreedingRepairMs,
      offspringCount: this.offspringCount,
    });
  }
}
