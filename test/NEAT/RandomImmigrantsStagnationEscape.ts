/**
 * Stagnation-trap escape test for random immigrants (Issue #2933).
 *
 * Demonstrates the acceptance criterion: a population escapes a deliberate
 * stagnation trap faster when random-immigrant injection is enabled.
 *
 * The landscape is a wide flat plateau (fitness 0.6 for x < 0.8) with the
 * only gradient hidden beyond x = 0.8. Pure mutation does an unbiased random
 * walk on the plateau and, with a small step size, effectively never crosses
 * the gap. Fresh immigrants sampled uniformly across the domain land beyond
 * the plateau edge, after which ordinary gradient ascent finishes the climb.
 *
 * This drives the *real* {@link PlateauDetector} and {@link RandomImmigrants}
 * controller; the population is modelled as scalar genomes so the test is
 * fast and fully deterministic (seeded RNG).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import { PlateauDetector } from "@neat/PlateauDetector.ts";
import { RandomImmigrants } from "@neat/RandomImmigrants.ts";
import { DEFAULT_RANDOM_IMMIGRANTS_CONFIG } from "@config/RandomImmigrantsConfig.ts";

const POPULATION = 30;
const ELITES = 2;
const MAX_GENERATIONS = 80;
const SIGMA = 0.01; // small steps → cannot cross the plateau by drift
const TARGET = 0.95;

/** Deterministic PRNG so the test is reproducible across runs. */
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

/** Flat plateau below 0.8; the only gradient is hidden beyond the edge. */
function trapFitness(x: number): number {
  if (x < 0.8) return 0.6;
  return 0.6 + (x - 0.8) * 2; // 0.6 at x=0.8 → 1.0 at x=1.0
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

interface RunResult {
  solved: boolean;
  generations: number;
}

function runTrap(useImmigrants: boolean, seed: number): RunResult {
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

  // Population starts trapped near the bottom of the plateau.
  let pop: number[] = [];
  for (let i = 0; i < POPULATION; i++) pop.push(rng() * 0.4);

  for (let gen = 0; gen < MAX_GENERATIONS; gen++) {
    // Evaluate and check for the global optimum.
    const scored = pop
      .map((x) => ({ x, f: trapFitness(x) }))
      .sort((a, b) => b.f - a.f);
    const best = scored[0].f;
    if (best >= TARGET) {
      return { solved: true, generations: gen };
    }

    detector.recordFitness(best);

    // Build the next generation: carry the elites, breed the remainder by
    // mutating a random elite (small Gaussian step — pure hill-climbing).
    const elites = scored.slice(0, ELITES).map((s) => s.x);
    const next = [...elites];
    while (next.length < POPULATION) {
      const parent = elites[Math.floor(rng() * elites.length)];
      next.push(clamp01(parent + gaussian(rng) * SIGMA));
    }

    // Inject random immigrants in place of the weakest non-elite offspring.
    if (
      immigrants.shouldInject(detector.getGenerationsOnPlateau(), gen)
    ) {
      const count = immigrants.immigrantCount(next.length, ELITES);
      // Offspring (indices >= ELITES) are unevaluated; replace the trailing
      // `count` of them with fresh uniform-random genomes.
      for (let i = 0; i < count; i++) {
        next[next.length - 1 - i] = rng();
      }
      immigrants.recordInjection(gen);
    }

    pop = next;
  }

  return { solved: false, generations: MAX_GENERATIONS };
}

Deno.test("RandomImmigrants - escapes a stagnation trap faster than pure mutation", () => {
  const seeds = [1, 2, 3, 4, 5];
  let withSolved = 0;
  let withoutSolved = 0;

  for (const seed of seeds) {
    const withImm = runTrap(true, seed);
    const withoutImm = runTrap(false, seed);

    if (withImm.solved) withSolved++;
    if (withoutImm.solved) withoutSolved++;

    // For every seed, enabling immigrants must escape at least as fast as
    // (and in practice much faster than) pure mutation.
    assert(
      withImm.generations <= withoutImm.generations,
      `seed ${seed}: immigrants (${withImm.generations}g) should not be ` +
        `slower than pure mutation (${withoutImm.generations}g)`,
    );
  }

  // Immigrants escape the trap on every seed; pure mutation stays stuck.
  assert(
    withSolved === seeds.length,
    `immigrants should solve all ${seeds.length} seeds, solved ${withSolved}`,
  );
  assert(
    withoutSolved < withSolved,
    `pure mutation should escape fewer traps than immigrants ` +
      `(without: ${withoutSolved}, with: ${withSolved})`,
  );
});

Deno.test("RandomImmigrants - evolveDataSet runs end-to-end with injection enabled", async () => {
  // Drives the real evolve() wiring with random immigrants enabled and an
  // aggressive trigger so an injection fires within the run. The XOR set with
  // a very low target error encourages stagnation, exercising the on-plateau
  // injection path on actual Creature genomes.
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 30,
    targetError: 0.0001,
    populationSize: 20,
    elitism: 2,
    threads: 1,
    plateauDetection: {
      enabled: true,
      windowSize: 3,
      minImprovementRate: 0.001,
      responseMutationMultiplier: 2.0,
    },
    randomImmigrants: {
      enabled: true,
      injectionFraction: 0.2,
      triggerWindow: 2,
      cooldown: 3,
    },
  });

  // The run completes and returns a well-formed result — the injection path
  // produced valid genomes that survived breeding, dedup and scoring.
  assertEquals(typeof result.error, "number");
  assertEquals(typeof result.score, "number");
  assert(Number.isFinite(result.error), "error should be finite");
});
