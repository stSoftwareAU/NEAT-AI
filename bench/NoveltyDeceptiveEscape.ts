/**
 * Issue #2932 - Novelty (behavioural-diversity) deceptive-escape benchmark.
 *
 * Compares generations-to-solve on a 1-D deceptive landscape with novelty
 * selection OFF (pure fitness) vs ON (fitness/novelty blend). The population
 * starts inside a deceptive basin near x=0 (fitness cap 0.8); the global
 * optimum (1.0) sits at x=1 across a fitness valley at x=0.5. Pure fitness
 * is trapped; novelty migrates the population across the valley.
 *
 * Run with:
 *   deno run --allow-read --allow-env bench/NoveltyDeceptiveEscape.ts
 */

import { DEFAULT_NOVELTY_CONFIG } from "@config/NoveltyConfig.ts";
import { blendScores, NoveltySearch } from "@neat/NoveltySearch.ts";

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

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function deceptiveFitness(x: number): number {
  if (x < 0.5) return 0.8 * (1 - x / 0.5);
  return (x - 0.5) / 0.5;
}

const POPULATION = 40;
const MAX_GENERATIONS = 150;
const SIGMA = 0.1;
const TARGET = 0.95;

function runDeceptive(useNovelty: boolean, seed: number): {
  solved: boolean;
  generations: number;
  bestFitness: number;
} {
  const rng = mulberry32(seed);
  let population: number[] = [];
  for (let i = 0; i < POPULATION; i++) population.push(rng() * 0.4);

  const search = new NoveltySearch({
    ...DEFAULT_NOVELTY_CONFIG,
    enabled: true,
    weight: 0.6,
    neighbours: 10,
  });

  let bestFitness = 0;
  for (let gen = 0; gen < MAX_GENERATIONS; gen++) {
    const fitness = population.map(deceptiveFitness);
    bestFitness = Math.max(bestFitness, ...fitness);
    if (bestFitness >= TARGET) {
      return { solved: true, generations: gen, bestFitness };
    }

    let selectionScore: number[];
    if (useNovelty) {
      const behaviours = population.map((x) => [x]);
      const novelty = search.computeNovelty(behaviours);
      search.updateArchive(behaviours, novelty);
      selectionScore = blendScores(fitness, novelty, search.config.weight);
    } else {
      selectionScore = fitness;
    }

    const order = population
      .map((_, i) => i)
      .sort((a, b) => selectionScore[b] - selectionScore[a]);
    const next: number[] = [population[order[0]]];
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

console.log("Deceptive-escape benchmark (Issue #2932)");
console.log("seed | fitness-only            | with-novelty");
const seeds = [12345, 222, 9001, 4242, 77777];
for (const seed of seeds) {
  const f = runDeceptive(false, seed);
  const n = runDeceptive(true, seed);
  const fTxt = f.solved
    ? `solved @ gen ${f.generations}`
    : `trapped (best ${f.bestFitness.toFixed(3)})`;
  const nTxt = n.solved
    ? `solved @ gen ${n.generations}`
    : `trapped (best ${n.bestFitness.toFixed(3)})`;
  console.log(
    `${String(seed).padEnd(5)}| ${fTxt.padEnd(24)}| ${nTxt}`,
  );
}
