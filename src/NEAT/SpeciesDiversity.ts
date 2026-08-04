/**
 * SpeciesDiversity.ts - Species diversity metric for adaptive population sizing.
 *
 * Extracted from the removed `HyperparameterEvolution.ts` (Issue #3569) — the
 * per-creature hyperparameter feature was withdrawn, but this metric is still
 * consumed by `AdaptivePopulationSizer.ts`.
 */

/**
 * Compute species diversity as the fraction of distinct species in the population.
 *
 * Returns a value in [0, 1] where 0 means all creatures are in one species
 * and 1 means each creature is its own species.
 */
export function computeSpeciesDiversity(
  speciesCount: number,
  populationSize: number,
): number {
  if (populationSize <= 1) return 1;
  return Math.min(1, speciesCount / populationSize);
}
