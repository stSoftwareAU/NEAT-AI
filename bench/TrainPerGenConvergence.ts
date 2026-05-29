/**
 * Issue #2791 - Benchmark: trainPerGen convergence
 *
 * Demonstrates that training more creatures per generation (`trainPerGen`)
 * converges materially faster on a supervised task. Each generation trains the
 * top `trainPerGen` creatures with real backpropagation
 * (`activateAndTrace` + `propagate` + `applyLearnings`) and evolves the rest by
 * perturbing copies of the fittest, mirroring the per-generation training loop
 * in `NeatEvolution.evolve()`.
 *
 * The comparison is fully deterministic (seeded RNG, shared initial
 * population), so the printed best-error figures are reproducible.
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-ffi bench/TrainPerGenConvergence.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff; // [0, 1)
  };
}

const INPUTS = 6;
const OUTPUTS = 3;
const HIDDEN = 8;
const DATASET_SIZE = 48;
const POPULATION = 24;
const GENERATIONS = 30;
const INNER_TRAIN_ITERS = 4;

// ---------------------------------------------------------------------------
// Build a small dense feed-forward network.
// ---------------------------------------------------------------------------
function buildNetwork(rng: () => number): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  const inputUUIDs = Array.from({ length: INPUTS }, (_, i) => `input-${i}`);
  const hiddenUUIDs: string[] = [];
  for (let h = 0; h < HIDDEN; h++) {
    const uuid = `h-${h}`;
    hiddenUUIDs.push(uuid);
    neurons.push({
      type: "hidden",
      uuid,
      squash: "TANH",
      bias: (rng() * 2 - 1) * 0.1,
    });
  }
  const outputUUIDs: string[] = [];
  for (let o = 0; o < OUTPUTS; o++) {
    const uuid = `output-${o}`;
    outputUUIDs.push(uuid);
    neurons.push({
      type: "output",
      uuid,
      squash: "LOGISTIC",
      bias: (rng() * 2 - 1) * 0.1,
    });
  }

  for (const from of inputUUIDs) {
    for (const to of hiddenUUIDs) {
      synapses.push({
        fromUUID: from,
        toUUID: to,
        weight: (rng() * 2 - 1) * 0.3,
      });
    }
  }
  for (const from of hiddenUUIDs) {
    for (const to of outputUUIDs) {
      synapses.push({
        fromUUID: from,
        toUUID: to,
        weight: (rng() * 2 - 1) * 0.3,
      });
    }
  }

  return { input: INPUTS, output: OUTPUTS, neurons, synapses };
}

// ---------------------------------------------------------------------------
// Supervised dataset: a fixed (random) target mapping the population must learn.
// ---------------------------------------------------------------------------
interface Sample {
  input: Float32Array;
  target: Float32Array;
}

function buildDataset(rng: () => number): Sample[] {
  // Random target weights for a logistic mapping of the inputs.
  const targetW: number[][] = Array.from(
    { length: OUTPUTS },
    () => Array.from({ length: INPUTS }, () => rng() * 2 - 1),
  );
  const logistic = (x: number) => 1 / (1 + Math.exp(-x));

  const samples: Sample[] = [];
  for (let s = 0; s < DATASET_SIZE; s++) {
    const input = new Float32Array(INPUTS);
    for (let i = 0; i < INPUTS; i++) input[i] = rng() * 2 - 1;
    const target = new Float32Array(OUTPUTS);
    for (let o = 0; o < OUTPUTS; o++) {
      let sum = 0;
      for (let i = 0; i < INPUTS; i++) sum += targetW[o][i] * input[i];
      target[o] = logistic(sum);
    }
    samples.push({ input, target });
  }
  return samples;
}

function meanError(creature: Creature, data: Sample[]): number {
  let total = 0;
  for (const { input, target } of data) {
    const out = creature.activate(input);
    for (let o = 0; o < OUTPUTS; o++) total += Math.abs(out[o] - target[o]);
  }
  return total / (data.length * OUTPUTS);
}

function trainCreature(creature: Creature, data: Sample[]): void {
  const json = creature.exportJSON();
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
  });
  const sparse = new SparseConfig(json, config);
  for (let iter = 0; iter < INNER_TRAIN_ITERS; iter++) {
    for (const { input, target } of data) {
      creature.activateAndTrace(input, false, sparse);
      creature.propagate(target, config, sparse);
    }
  }
  creature.applyLearnings(config, sparse);
}

function perturb(
  source: Creature,
  rng: () => number,
  scale: number,
): Creature {
  const json = source.exportJSON();
  for (const s of json.synapses) s.weight += (rng() * 2 - 1) * scale;
  for (const n of json.neurons) {
    if (typeof n.bias === "number") n.bias += (rng() * 2 - 1) * scale;
  }
  return Creature.fromJSON(json);
}

// ---------------------------------------------------------------------------
// One full evolution run for a given trainPerGen.
// ---------------------------------------------------------------------------
function runEvolution(
  initialJson: CreatureExport[],
  data: Sample[],
  trainPerGen: number,
): number {
  const rng = seededRandom(424242 + trainPerGen);
  let pop = initialJson.map((j) => Creature.fromJSON(structuredClone(j)));

  let best = Number.POSITIVE_INFINITY;
  for (let gen = 0; gen < GENERATIONS; gen++) {
    // Evaluate and sort ascending by error (fittest first).
    const scored = pop.map((c) => ({ c, e: meanError(c, data) }));
    scored.sort((a, b) => a.e - b.e);
    best = scored[0].e;

    // Train the top `trainPerGen` creatures with real backprop.
    for (let i = 0; i < Math.min(trainPerGen, scored.length); i++) {
      trainCreature(scored[i].c, data);
    }

    // Evolve: keep the better half, replace the worse half with perturbed
    // copies of a top-quarter creature.
    const keep = Math.ceil(scored.length / 2);
    const topQuarter = Math.max(1, Math.floor(scored.length / 4));
    const next: Creature[] = scored.slice(0, keep).map((s) => s.c);
    while (next.length < scored.length) {
      const parent = scored[Math.floor(rng() * topQuarter)].c;
      next.push(perturb(parent, rng, 0.1));
    }
    pop = next;
  }

  // Final best after the last training round.
  const finalScored = pop.map((c) => meanError(c, data));
  finalScored.sort((a, b) => a - b);
  return Math.min(best, finalScored[0]);
}

// ---------------------------------------------------------------------------
// Shared setup and comparison.
// ---------------------------------------------------------------------------
const setupRng = seededRandom(2791);
const dataset = buildDataset(setupRng);

// Build a shared initial population (same starting point for every run).
const initialPopulation: CreatureExport[] = [];
for (let p = 0; p < POPULATION; p++) {
  initialPopulation.push(buildNetwork(setupRng));
}

const baseError = (() => {
  let total = 0;
  for (const j of initialPopulation) {
    total += meanError(Creature.fromJSON(structuredClone(j)), dataset);
  }
  return total / initialPopulation.length;
})();

console.log("Issue #2791 - trainPerGen convergence benchmark");
console.log(
  `Population: ${POPULATION}, generations: ${GENERATIONS}, dataset: ${DATASET_SIZE} samples`,
);
console.log(`Mean initial population error: ${baseError.toFixed(6)}\n`);

const trainPerGenValues = [1, 4, 10];
const results: { trainPerGen: number; bestError: number }[] = [];
for (const tpg of trainPerGenValues) {
  const bestError = runEvolution(initialPopulation, dataset, tpg);
  results.push({ trainPerGen: tpg, bestError });
  console.log(
    `trainPerGen=${tpg.toString().padStart(2)} -> best error ${
      bestError.toFixed(6)
    }`,
  );
}

const baseline = results.find((r) => r.trainPerGen === 1)!.bestError;
console.log("\nImprovement vs trainPerGen=1 (higher is better):");
for (const r of results) {
  const improvement = ((1 - r.bestError / baseline) * 100).toFixed(2);
  console.log(
    `  trainPerGen=${r.trainPerGen.toString().padStart(2)}: ${improvement}%`,
  );
}

// A single training step, exposed for `deno bench`.
const benchCreature = Creature.fromJSON(structuredClone(initialPopulation[0]));
Deno.bench("trainPerGenConvergence: single creature backprop step", () => {
  trainCreature(benchCreature, dataset);
});
