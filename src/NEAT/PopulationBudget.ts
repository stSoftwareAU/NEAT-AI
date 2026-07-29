/**
 * PopulationBudget.ts - Assemble the next generation without exceeding the
 * configured population budget.
 *
 * Issue #3508: the next population was built by concatenating five slices
 * (elitists, trained, fine-tuned, bred, DNA) but only the *bred* slice was
 * budgeted. The bred budget is computed before the completed heavy-pool
 * results are drained, so when several training / discovery / replay tasks
 * land in the same generation — each training task can yield up to four
 * creatures — the assembled population grew well past `populationSize`,
 * inflating memory, CPU and the fitness queue depth for the next generation.
 */

import { assert } from "@std/assert";
import type { Creature } from "@creature";

/** The five slices that make up the next generation, in population order. */
export interface PopulationSlices {
  /** Elites carried forward unchanged. Never trimmed. */
  elitists: Creature[];
  /** Creatures returned by completed training, discovery and replay tasks. */
  trained: Creature[];
  /** Fine-tuned variants of the fittest creature. */
  fineTuned: Creature[];
  /** Creative-thinking clone plus the bred offspring. */
  bred: Creature[];
  /** CRISPR (DNA) enhanced creatures. */
  dna: Creature[];
}

/** Outcome of {@link assemblePopulationWithinBudget}. */
export interface BudgetedPopulation {
  /** The assembled population, capped at the budget. */
  population: Creature[];
  /** Creatures excluded by the cap, so the caller can dispose of them. */
  dropped: Creature[];
}

/**
 * Trim order when the slices overflow the budget — weakest contribution
 * first. The bred slice is trimmed first because its size was budgeted
 * against a stale (smaller) count of completed heavy-pool results; dropping
 * offspring restores the budget the breeder would have been given had the
 * true count been known, without discarding expensive trained or discovered
 * creatures.
 */
const TRIM_ORDER = ["bred", "trained", "fineTuned", "dna"] as const;

/** Slices in the order they appear in the assembled population. */
const POPULATION_ORDER = [
  "elitists",
  "trained",
  "fineTuned",
  "bred",
  "dna",
] as const;

/**
 * Concatenate the population slices, capped at `budget` creatures.
 *
 * Elitism is a hard guarantee, so the returned population is never shorter
 * than `slices.elitists`: when the elite slice alone exceeds the budget the
 * effective cap becomes `elitists.length` and every other slice is dropped.
 *
 * @param slices - The five population slices.
 * @param budget - The effective population size for this generation.
 * @returns The capped population plus the creatures that were dropped.
 */
export function assemblePopulationWithinBudget(
  slices: PopulationSlices,
  budget: number,
): BudgetedPopulation {
  assert(
    Number.isFinite(budget),
    `Population budget must be finite, was ${budget}`,
  );

  const keep = new Map<keyof PopulationSlices, number>(
    POPULATION_ORDER.map((name) => [name, slices[name].length]),
  );

  const total = POPULATION_ORDER.reduce(
    (sum, name) => sum + slices[name].length,
    0,
  );

  let excess = total - Math.max(Math.floor(budget), slices.elitists.length);

  for (const name of TRIM_ORDER) {
    if (excess <= 0) break;
    const available = slices[name].length;
    const remove = Math.min(excess, available);
    keep.set(name, available - remove);
    excess -= remove;
  }

  const population: Creature[] = [];
  const dropped: Creature[] = [];
  for (const name of POPULATION_ORDER) {
    const slice = slices[name];
    const keptCount = keep.get(name) ?? slice.length;
    for (let i = 0; i < slice.length; i++) {
      (i < keptCount ? population : dropped).push(slice[i]);
    }
  }

  return { population, dropped };
}
