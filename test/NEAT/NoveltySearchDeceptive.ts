import { assert } from "@std/assert";
import { DEFAULT_NOVELTY_CONFIG } from "@config/NoveltyConfig.ts";
import { blendScores, NoveltySearch } from "@neat/NoveltySearch.ts";

/**
 * Deceptive-landscape acceptance test (Issue #2932).
 *
 * A 1-D deceptive fitness landscape: the population starts inside a
 * deceptive basin near `x = 0` whose fitness caps at `0.8`, while the global
 * optimum (`1.0`) sits at `x = 1`, on the far side of a fitness valley at
 * `x = 0.5`. Pure-fitness selection climbs into the trap and cannot cross
 * the valley; novelty selection rewards behavioural spread and migrates the
 * population rightward, escaping the trap in far fewer generations.
 *
 * The simulation is fully deterministic (seeded PRNG, no wall-clock timing),
 * so the comparison is reproducible.
 */

/** Deterministic mulberry32 PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sample via Box-Muller from a uniform PRNG. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deceptive fitness: trap basin caps at 0.8 near x=0; optimum 1.0 at x=1. */
function deceptiveFitness(x: number): number {
  if (x < 0.5) return 0.8 * (1 - x / 0.5);
  return (x - 0.5) / 0.5;
}

const POPULATION = 40;
const MAX_GENERATIONS = 150;
const SIGMA = 0.1;
const TARGET = 0.95;
const SEED = 12345;

interface RunResult {
  solved: boolean;
  generations: number;
  bestFitness: number;
}

/**
 * Run the deceptive GA. With `useNovelty`, ranking blends fitness with a
 * kNN novelty score over the behaviour descriptor `[x]`; otherwise ranking
 * is pure fitness. Both modes share the same seed so the only difference is
 * the selection criterion.
 */
function runDeceptive(useNovelty: boolean): RunResult {
  const rng = mulberry32(SEED);
  // All genomes start inside the deceptive basin [0, 0.4].
  let population: number[] = [];
  for (let i = 0; i < POPULATION; i++) population.push(rng() * 0.4);

  const search = new NoveltySearch({
    ...DEFAULT_NOVELTY_CONFIG,
    enabled: true,
    weight: 0.6,
    neighbours: 10,
    archiveLimit: 500,
  });

  let bestFitness = 0;
  for (let gen = 0; gen < MAX_GENERATIONS; gen++) {
    const fitness = population.map(deceptiveFitness);
    bestFitness = Math.max(bestFitness, ...fitness);
    if (bestFitness >= TARGET) {
      return { solved: true, generations: gen, bestFitness };
    }

    // Selection score: blended novelty or raw fitness.
    let selectionScore: number[];
    if (useNovelty) {
      const behaviours = population.map((x) => [x]);
      const novelty = search.computeNovelty(behaviours);
      search.updateArchive(behaviours, novelty);
      selectionScore = blendScores(fitness, novelty, search.config.weight);
    } else {
      selectionScore = fitness;
    }

    // Rank by selection score (descending).
    const order = population
      .map((_, i) => i)
      .sort((a, b) => selectionScore[b] - selectionScore[a]);

    // Elitism: carry the top individual unchanged.
    const next: number[] = [population[order[0]]];

    // Breed the rest via tournament selection + Gaussian mutation.
    while (next.length < POPULATION) {
      const a = order[Math.floor(rng() * order.length)];
      const b = order[Math.floor(rng() * order.length)];
      const parent = selectionScore[a] >= selectionScore[b] ? a : b;
      let child = population[parent] + gaussian(rng) * SIGMA;
      child = Math.min(1, Math.max(0, child));
      next.push(child);
    }
    population = next;
  }

  return { solved: false, generations: MAX_GENERATIONS, bestFitness };
}

Deno.test("NoveltySearch - escapes a deceptive landscape in fewer generations", () => {
  const fitnessOnly = runDeceptive(false);
  const withNovelty = runDeceptive(true);

  // Pure-fitness selection is trapped in the deceptive basin (cap 0.8) and
  // never reaches the global optimum within the generation budget.
  assert(
    !fitnessOnly.solved,
    `fitness-only unexpectedly solved at gen ${fitnessOnly.generations} ` +
      `(best=${fitnessOnly.bestFitness})`,
  );

  // Novelty selection escapes the trap and reaches the global optimum.
  assert(
    withNovelty.solved,
    `novelty failed to solve (best=${withNovelty.bestFitness})`,
  );

  // Acceptance criterion: fewer generations to escape with novelty enabled.
  assert(
    withNovelty.generations < fitnessOnly.generations,
    `expected novelty (${withNovelty.generations}) < ` +
      `fitness-only (${fitnessOnly.generations})`,
  );
});
