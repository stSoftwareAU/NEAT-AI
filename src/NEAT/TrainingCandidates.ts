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
  // One rule, one implementation: this is the ranked selection with the rank
  // dropped, so the two can never drift into selecting different creatures
  // (Issue #3934).
  return selectRankedTrainingCandidates(sortedPopulation, limit).map(
    (candidate) => candidate.creature,
  );
}

/**
 * A training candidate together with the rank the rule selected it at.
 *
 * Issue #3934: the rank is the one thing the selection rule knows and the
 * training event did not record. The rule takes the top `trainPerGen` ranks, so
 * without this column nothing downstream can ask whether present fitness
 * predicts what a gradient step realises.
 */
export interface RankedTrainingCandidate {
  /** The creature to train. */
  readonly creature: Creature;
  /**
   * Position among the finite-score creatures of the score-sorted population:
   * `0` is the fittest, `1` the next, and so on.
   *
   * Non-finite-score creatures are not viable training targets and are not
   * ranked, so the rank counts candidates the rule could have chosen rather
   * than array positions it had to skip.
   */
  readonly rank: number;
}

/**
 * Pick up to `limit` training candidates, each with its selection rank.
 *
 * Identical selection to {@link selectTrainingCandidates} — this is the same
 * rule reporting what it did, not a different rule. Issue #3934 adds the
 * reporting; the policy is unchanged.
 *
 * @param sortedPopulation - Population sorted by descending score.
 * @param limit - Maximum number of candidates to return (`trainPerGen`).
 * @returns The top `limit` finite-score creatures with their ranks, in
 *   population order.
 */
export function selectRankedTrainingCandidates(
  sortedPopulation: Creature[],
  limit: number,
): RankedTrainingCandidate[] {
  if (limit <= 0) {
    return [];
  }

  const candidates: RankedTrainingCandidate[] = [];
  let rank = 0;
  for (const creature of sortedPopulation) {
    if (candidates.length >= limit) {
      break;
    }
    if (Number.isFinite(creature.score)) {
      candidates.push({ creature, rank });
      rank++;
    }
  }
  return candidates;
}

/**
 * Count the creatures the rank in {@link selectRankedTrainingCandidates} is
 * taken over: those with a finite score.
 *
 * Recorded beside the rank because rank 3 of 5 and rank 3 of 50 are different
 * observations, and a population whose scores mostly failed to evaluate is the
 * case where that difference is largest.
 *
 * @param sortedPopulation - The population the candidates were drawn from.
 * @returns The number of finite-score creatures in it.
 */
export function countRankableCreatures(
  sortedPopulation: readonly Creature[],
): number {
  let count = 0;
  for (const creature of sortedPopulation) {
    if (Number.isFinite(creature.score)) count++;
  }
  return count;
}
