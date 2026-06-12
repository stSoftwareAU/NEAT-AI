/**
 * Issue #2933 - Random-immigrants stagnation-trap escape benchmark.
 *
 * Compares generations-to-solve on a deliberate stagnation trap with
 * random-immigrant injection OFF (pure mutation) vs ON. The landscape is a
 * wide flat plateau (fitness 0.6 for x < 0.8) whose only gradient is hidden
 * beyond x = 0.8. With a small mutation step the population does an unbiased
 * random walk on the plateau and effectively never crosses the gap; fresh
 * immigrants sampled uniformly across the domain land beyond the edge, after
 * which ordinary gradient ascent finishes the climb.
 *
 * Drives the real PlateauDetector + RandomImmigrants controller. Population
 * is modelled as scalar genomes so the benchmark is fast and deterministic.
 *
 * Run with:
 *   deno run --allow-read --allow-env bench/RandomImmigrantsStagnationEscape.ts
 */

import { PlateauDetector } from "@neat/PlateauDetector.ts";
import { RandomImmigrants } from "@neat/RandomImmigrants.ts";
import { DEFAULT_RANDOM_IMMIGRANTS_CONFIG } from "@config/RandomImmigrantsConfig.ts";

const POPULATION = 30;
const ELITES = 2;
const MAX_GENERATIONS = 80;
const SIGMA = 0.01;
const TARGET = 0.95;

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

function trapFitness(x: number): number {
  if (x < 0.8) return 0.6;
  return 0.6 + (x - 0.8) * 2;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function runTrap(useImmigrants: boolean, seed: number): {
  solved: boolean;
  generations: number;
  bestFitness: number;
} {
  const rng = mulberry32(seed);

  const detector = new PlateauDetector({
    windowSize: 5,
    minImprovementRate: 0.001,
    rapidImprovementRate: 0.01,
    responseMutationMultiplier: 1.0,
    responseImprovementMultiplier: 1.0,
    enabled: true,
  });

  const immigrants = new RandomImmigrants({
    ...DEFAULT_RANDOM_IMMIGRANTS_CONFIG,
    enabled: useImmigrants,
    injectionFraction: 0.3,
    triggerWindow: 3,
    cooldown: 5,
  });

  let pop: number[] = [];
  for (let i = 0; i < POPULATION; i++) pop.push(rng() * 0.4);

  let bestFitness = 0;
  for (let gen = 0; gen < MAX_GENERATIONS; gen++) {
    const scored = pop
      .map((x) => ({ x, f: trapFitness(x) }))
      .sort((a, b) => b.f - a.f);
    bestFitness = Math.max(bestFitness, scored[0].f);
    if (bestFitness >= TARGET) {
      return { solved: true, generations: gen, bestFitness };
    }

    detector.recordFitness(scored[0].f);

    const elites = scored.slice(0, ELITES).map((s) => s.x);
    const next = [...elites];
    while (next.length < POPULATION) {
      const parent = elites[Math.floor(rng() * elites.length)];
      next.push(clamp01(parent + gaussian(rng) * SIGMA));
    }

    if (immigrants.shouldInject(detector.getGenerationsOnPlateau(), gen)) {
      const count = immigrants.immigrantCount(next.length, ELITES);
      for (let i = 0; i < count; i++) {
        next[next.length - 1 - i] = rng();
      }
      immigrants.recordInjection(gen);
    }

    pop = next;
  }

  return { solved: false, generations: MAX_GENERATIONS, bestFitness };
}

const seeds = [1, 2, 3, 4, 5];
console.log("seed | immigrants OFF        | immigrants ON");
console.log("-----+-----------------------+----------------------");
for (const seed of seeds) {
  const off = runTrap(false, seed);
  const on = runTrap(true, seed);
  const fmt = (r: { solved: boolean; generations: number }) =>
    r.solved ? `solved @ gen ${r.generations}` : `stuck (>= ${r.generations})`;
  console.log(
    `  ${seed}  | ${fmt(off).padEnd(21)} | ${fmt(on)}`,
  );
}
