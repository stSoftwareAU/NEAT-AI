/**
 * Issue #2791: select the creatures eligible for per-generation backpropagation.
 *
 * The per-generation training loop previously iterated only the elitist slice
 * (`results.elitists`), whose length equals the `elitism` setting. With the
 * default `elitism` of 1 this capped gradient training at a single creature per
 * generation regardless of `trainPerGen`, so raising `trainPerGen` had no
 * effect. Selecting from the (already score-sorted) population lets
 * `trainPerGen` actually govern how many creatures receive a gradient step.
 */

import type { Creature } from "@creature";

/**
 * Pick up to `limit` training candidates from a score-sorted population.
 *
 * The population is expected to be sorted by descending score, so the fittest
 * creatures with a finite score are returned first. Creatures with a
 * non-finite score (e.g. WASM-panicked evaluations scored `-Infinity`) are
 * skipped — they are not viable training targets.
 *
 * @param sortedPopulation - Population sorted by descending score.
 * @param limit - Maximum number of candidates to return (`trainPerGen`).
 * @returns The top `limit` finite-score creatures, in population order.
 */
export function selectTrainingCandidates(
  sortedPopulation: Creature[],
  limit: number,
): Creature[] {
  if (limit <= 0) {
    return [];
  }

  const candidates: Creature[] = [];
  for (const creature of sortedPopulation) {
    if (candidates.length >= limit) {
      break;
    }
    if (Number.isFinite(creature.score)) {
      candidates.push(creature);
    }
  }
  return candidates;
}
