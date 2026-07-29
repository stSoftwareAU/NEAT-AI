/**
 * PopulationCap.ts - Hard bound on the assembled population (Issue #3508).
 *
 * The next generation is assembled by concatenating several slices — elites,
 * completed training / discovery results, fine-tuned creatures, freshly bred
 * offspring, and CRISPR (Clustered Regularly Interspaced Short Palindromic
 * Repeats) variants. Only the bred slice was budgeted against the effective
 * population size, so when several heavy-pool tasks completed in the same
 * generation the population — and therefore the next generation's fitness
 * queue — grew well past the configured size.
 *
 * {@link trimPopulationToSize} applies the missing bound after assembly.
 */

import type { Creature } from "@creature";

/** Outcome of a population trim pass. */
export interface PopulationTrimResult {
  /** Number of non-elite creatures dropped from the population. */
  removed: number;
  /** UUIDs of the dropped creatures (for logging / telemetry). */
  removedUuids: string[];
}

/**
 * Trims a population back to `maxSize`, dropping the weakest non-elite
 * creatures.
 *
 * The first `eliteCount` entries are treated as elites and are never dropped:
 * elitism guarantees the best creatures survive, so the cap is enforced on the
 * remainder. A configuration where the elites alone exceed `maxSize` therefore
 * leaves the population at `eliteCount` — elitism wins over the cap.
 *
 * Non-elites are ranked worst-first by score. Creatures without a finite score
 * have not been evaluated yet, so there is nothing to rank them by; they are
 * treated as the weakest and ties are broken by assembly order. Because the
 * caller assembles the array in descending order of provenance
 * (elites → trained → fine-tuned → bred → CRISPR), that tie-break drops the
 * over-represented heavy-pool results — the slice that overflows the budget —
 * ahead of the freshly bred offspring that drive exploration.
 *
 * Survivors keep their original relative order, so the population stays
 * "pseudo sorted" with the elites at the front.
 *
 * Dropped creatures are **not** disposed: the same objects are frequently
 * still referenced by the breeding genus, and `Creature.dispose()` empties
 * `neurons`/`synapses`, which would leave a corrupt genome behind that later
 * crashes mid-breed (the same ownership rule as `injectRandomImmigrants`).
 * Ownership is shared, so this helper only drops references; the WASM
 * (WebAssembly) activation cache bounds their memory and GC reclaims the rest.
 *
 * @param population - The population array (elites first). Mutated in place.
 * @param eliteCount - Number of leading elites to preserve.
 * @param maxSize - Maximum number of creatures to keep.
 * @returns How many creatures were dropped, and their UUIDs.
 */
export function trimPopulationToSize(
  population: Creature[],
  eliteCount: number,
  maxSize: number,
): PopulationTrimResult {
  const total = population.length;
  const capacity = Number.isFinite(maxSize)
    ? Math.max(0, Math.floor(maxSize))
    : 0;
  if (total <= capacity) {
    return { removed: 0, removedUuids: [] };
  }

  const safeElite = Math.max(0, Math.min(Math.floor(eliteCount) || 0, total));
  const keepNonElite = Math.max(0, capacity - safeElite);
  const nonEliteCount = total - safeElite;
  const dropCount = nonEliteCount - keepNonElite;
  if (dropCount <= 0) {
    // Elites alone meet or exceed the cap — never drop an elite.
    return { removed: 0, removedUuids: [] };
  }

  const ranked: { creature: Creature; index: number }[] = [];
  for (let index = safeElite; index < total; index++) {
    ranked.push({ creature: population[index], index });
  }
  ranked.sort(compareWorstFirst);

  const dropped = new Set<number>();
  const removedUuids: string[] = [];
  for (let i = 0; i < dropCount; i++) {
    const victim = ranked[i];
    dropped.add(victim.index);
    if (victim.creature.uuid) {
      removedUuids.push(victim.creature.uuid);
    }
  }

  // Rebuild in place, preserving the original (pseudo sorted) order.
  let write = 0;
  for (let read = 0; read < total; read++) {
    if (!dropped.has(read)) {
      population[write++] = population[read];
    }
  }
  population.length = write;

  return { removed: dropCount, removedUuids };
}

/**
 * Worst-first comparator. Unscored creatures rank as the weakest; equal
 * scores fall back to assembly order so the ranking is deterministic.
 */
function compareWorstFirst(
  a: { creature: Creature; index: number },
  b: { creature: Creature; index: number },
): number {
  const scoreA = scoreOf(a.creature);
  const scoreB = scoreOf(b.creature);
  if (scoreA !== scoreB) {
    // Explicit comparison rather than subtraction: -Infinity - -Infinity is
    // NaN, which would leave the sort order undefined.
    return scoreA < scoreB ? -1 : 1;
  }
  return a.index - b.index;
}

/** Score used for worst-first ranking; missing scores rank as weakest. */
function scoreOf(creature: Creature): number {
  return typeof creature.score === "number" && Number.isFinite(creature.score)
    ? creature.score
    : -Infinity;
}
