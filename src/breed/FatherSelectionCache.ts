/**
 * Per-generation cache of fitness rankings reused across father selection
 * (Issue #3474).
 *
 * `findFather` runs once per parent pair — roughly population-size times per
 * generation — and previously rebuilt a {@link FitnessRanking} (a full score
 * Map plus a sort) on every call, giving O(n² log n) ranking work per
 * generation. This cache builds each ranking at most once per generation: one
 * whole-population ranking for the global-breeding path and one ranking per
 * species for the within-species path.
 *
 * The cached rankings rank the **full** pool (they may include the mother);
 * the caller excludes the mother and any skipped candidates at selection time
 * via rejection sampling, so the cache never needs per-mother copies.
 *
 * Father selection ranks by **raw** fitness. When the batch-level population
 * ranking was built from adjusted/override scores (fitness sharing,
 * group-relative advantage), it MUST NOT be handed to this cache — a raw
 * ranking is built lazily instead so father-selection distribution is
 * unchanged.
 */
import type { Creature } from "@creature";
import { FitnessRanking } from "@breed/FitnessRanking.ts";

export class FatherSelectionCache {
  readonly #population: Creature[];
  #populationRanking?: FitnessRanking;
  readonly #speciesRankings = new Map<string, FitnessRanking>();

  /**
   * @param population - The generation's full population.
   * @param populationRanking - Optional pre-built **raw-score** population
   *   ranking to reuse (the batch ranking, when it was built from raw scores).
   *   Omit when the batch ranking uses adjusted/override scores.
   */
  constructor(population: Creature[], populationRanking?: FitnessRanking) {
    this.#population = population;
    this.#populationRanking = populationRanking;
  }

  /**
   * Raw-score ranking over the whole population, built at most once.
   *
   * @returns The cached population ranking.
   */
  populationRanking(): FitnessRanking {
    if (!this.#populationRanking) {
      this.#populationRanking = new FitnessRanking(this.#population);
    }
    return this.#populationRanking;
  }

  /**
   * Raw-score ranking over one species' members, built at most once per
   * species key for the lifetime of this cache (one generation).
   *
   * @param speciesKey - Stable per-generation species identifier.
   * @param creatures - The species members to rank.
   * @returns The cached ranking for that species.
   */
  speciesRanking(speciesKey: string, creatures: Creature[]): FitnessRanking {
    let ranking = this.#speciesRankings.get(speciesKey);
    if (!ranking) {
      ranking = new FitnessRanking(creatures);
      this.#speciesRankings.set(speciesKey, ranking);
    }
    return ranking;
  }
}
