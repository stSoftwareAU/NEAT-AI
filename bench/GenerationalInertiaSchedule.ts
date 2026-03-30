/**
 * Issue #1655 - Benchmark: Generational Inertia Schedule Comparison
 *
 * Compares convergence of different inertia growth schedules over 60
 * iterations on a production-sized creature. Measures how quickly
 * weight/bias updates converge under:
 *   1. Linear growth (current): generations = base + iteration
 *   2. Logarithmic growth: generations = base + ceil(log2(iteration + 1))
 *   3. Square-root growth: generations = base + ceil(sqrt(iteration))
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-ffi bench/GenerationalInertiaSchedule.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

// Seeded random for reproducibility.
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(1655);

const SQUASH_NAMES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "GELU",
  "LeakyReLU",
];

function buildProductionNetwork(
  inputCount: number,
  outputCount: number,
  hiddenLayers: number[],
  maxFanOut: number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const layerUUIDs: string[][] = [];

  const inputUUIDs = Array.from(
    { length: inputCount },
    (_, i) => `input-${i}`,
  );
  layerUUIDs.push(inputUUIDs);

  for (let l = 0; l < hiddenLayers.length; l++) {
    const layerSize = hiddenLayers[l];
    const uuids: string[] = [];
    for (let n = 0; n < layerSize; n++) {
      const uuid = `h${l}-${n}`;
      uuids.push(uuid);
      const squash = SQUASH_NAMES[
        Math.floor(
          (Math.abs(random()) * SQUASH_NAMES.length) % SQUASH_NAMES.length,
        )
      ];
      neurons.push({
        type: "hidden",
        uuid,
        squash,
        bias: random() * 0.1,
      });
    }
    layerUUIDs.push(uuids);
  }

  const outputUUIDs: string[] = [];
  for (let i = 0; i < outputCount; i++) {
    const uuid = `output-${i}`;
    outputUUIDs.push(uuid);
    neurons.push({
      type: "output",
      uuid,
      squash: "IDENTITY",
      bias: random() * 0.1,
    });
  }
  layerUUIDs.push(outputUUIDs);

  for (let l = 0; l < layerUUIDs.length - 1; l++) {
    const fromLayer = layerUUIDs[l];
    const toLayer = layerUUIDs[l + 1];
    for (const fromUUID of fromLayer) {
      const fanOut = Math.min(maxFanOut, toLayer.length);
      const step = Math.max(1, Math.floor(toLayer.length / fanOut));
      for (let t = 0; t < toLayer.length; t += step) {
        synapses.push({
          fromUUID,
          toUUID: toLayer[t],
          weight: random() * 0.3,
        });
      }
    }
  }

  return { input: inputCount, output: outputCount, neurons, synapses };
}

const productionJson = buildProductionNetwork(50, 10, [200, 300, 250, 150], 20);
const totalNeurons = productionJson.neurons.length + productionJson.input;
const totalSynapses = productionJson.synapses.length;
console.log(
  `Production network: ${totalNeurons} neurons, ${totalSynapses} synapses`,
);

const NUM_SAMPLES = 20;
const inputs: Float32Array[] = [];
const targets: Float32Array[] = [];
for (let s = 0; s < NUM_SAMPLES; s++) {
  const input = new Float32Array(productionJson.input);
  for (let i = 0; i < input.length; i++) input[i] = random();
  inputs.push(input);
  const target = new Float32Array(productionJson.output);
  for (let i = 0; i < target.length; i++) target[i] = random() * 0.5;
  targets.push(target);
}

function measureError(creature: Creature): number {
  let totalError = 0;
  for (let s = 0; s < NUM_SAMPLES; s++) {
    const result = creature.activate(inputs[s]);
    for (let i = 0; i < targets[s].length; i++) {
      totalError += (result[i] - targets[s][i]) ** 2;
    }
  }
  return totalError / NUM_SAMPLES;
}

type ScheduleFn = (base: number, iteration: number) => number;

function runConvergenceTest(
  generationsSchedule: ScheduleFn,
  totalIterations: number,
): { errors: number[]; generationsUsed: number[] } {
  const baseGenerations = 5;
  const creature = Creature.fromJSON(productionJson);
  const errors: number[] = [];
  const generationsUsed: number[] = [];

  errors.push(measureError(creature));

  for (let iter = 0; iter < totalIterations; iter++) {
    const generations = generationsSchedule(baseGenerations, iter + 1);
    generationsUsed.push(generations);

    const config = createBackPropagationConfig({
      generations,
      learningRate: 0.01,
      plankConstant: 1e-7,
      maximumWeightAdjustmentScale: 1,
      maximumBiasAdjustmentScale: 1,
      disableRandomSamples: true,
      batchSize: 1,
    });
    const sparseConfig = new SparseConfig(productionJson, config);

    for (let s = 0; s < NUM_SAMPLES; s++) {
      creature.activateAndTrace(inputs[s], false, sparseConfig);
      creature.propagate(targets[s], config, sparseConfig);
    }
    creature.applyLearnings(config, sparseConfig);
    errors.push(measureError(creature));
  }

  return { errors, generationsUsed };
}

// --- Schedule functions ---

const linearSchedule: ScheduleFn = (base, iter) => base + iter;

const logSchedule: ScheduleFn = (base, iter) =>
  base + Math.ceil(Math.log2(iter + 1));

const sqrtSchedule: ScheduleFn = (base, iter) =>
  base + Math.ceil(Math.sqrt(iter));

// --- Run ---

const TOTAL_ITERATIONS = 60;

console.log(`\n=== Generational Inertia Schedule Comparison ===`);
console.log(`Iterations: ${TOTAL_ITERATIONS}, Samples/iter: ${NUM_SAMPLES}\n`);

const results: {
  label: string;
  data: ReturnType<typeof runConvergenceTest>;
}[] = [];

for (
  const [label, fn] of [
    ["Linear (base+iter)", linearSchedule],
    ["Log2 (base+log2)", logSchedule],
    ["Sqrt (base+sqrt)", sqrtSchedule],
  ] as [string, ScheduleFn][]
) {
  console.log(`Running: ${label} ...`);
  results.push({ label, data: runConvergenceTest(fn, TOTAL_ITERATIONS) });
}

// Print comparison table.
console.log("\n=== Convergence at Key Milestones ===");
const header = "Iter | " +
  results.map((r) => `${r.label.padEnd(20)}`).join(" | ");
console.log(header);
console.log("-".repeat(header.length));

const milestones = [0, 5, 10, 20, 30, 40, 50, 59];
for (const i of milestones) {
  const cols = results.map((r) => {
    const err = r.data.errors[i + 1] ?? r.data.errors[i];
    const gen = r.data.generationsUsed[i] ?? 0;
    return `${err.toFixed(8)} (g=${String(gen).padStart(3)})`;
  });
  console.log(`${String(i).padStart(4)} | ${cols.join(" | ")}`);
}

// Summary.
console.log(`\n=== Summary ===`);
const initial = results[0].data.errors[0];
console.log(`Initial error: ${initial.toFixed(10)}`);
for (const r of results) {
  const final = r.data.errors[TOTAL_ITERATIONS];
  const pct = ((1 - final / initial) * 100).toFixed(4);
  console.log(
    `${r.label.padEnd(25)} final=${final.toFixed(10)} (${pct}% improvement)`,
  );
}

// Generation growth comparison.
console.log(`\n=== Generation Growth ===`);
for (const iter of [1, 10, 30, 50, 60]) {
  const idx = iter - 1;
  const vals = results
    .map((r) => `${r.label.split(" ")[0]}=${r.data.generationsUsed[idx]}`)
    .join(", ");
  console.log(`  Iteration ${String(iter).padStart(2)}: ${vals}`);
}
