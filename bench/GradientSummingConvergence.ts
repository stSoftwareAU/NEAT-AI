/**
 * Issue #1651 - Benchmark: Gradient Summing Convergence
 *
 * Measures convergence of backpropagation on a production-sized creature
 * (~976 neurons, ~18,605 synapses) to verify that summed error signals
 * produce equal or improved convergence compared to the previous averaging
 * approach.
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-ffi bench/GradientSummingConvergence.ts
 */

import { Creature } from "@creature";
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

const random = seededRandom(1651);

const SQUASH_NAMES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "GELU",
  "LeakyReLU",
];

/**
 * Build a densely connected feed-forward network approximating production
 * scale (~976 neurons, ~18,605 synapses).
 */
function buildProductionNetwork(
  inputCount: number,
  outputCount: number,
  hiddenLayers: number[],
  maxFanOut: number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  const layerUUIDs: string[][] = [];

  // Input layer UUIDs.
  const inputUUIDs = Array.from(
    { length: inputCount },
    (_, i) => `input-${i}`,
  );
  layerUUIDs.push(inputUUIDs);

  // Hidden layers.
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

  // Output layer.
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

  // Connect layers with sparse fan-out.
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

  return {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  };
}

// Build a production-scale network.
const productionJson = buildProductionNetwork(
  50, // observations/inputs
  10, // outputs
  [200, 300, 250, 150], // hidden layers (~900 hidden neurons)
  20, // max fan-out per neuron
);

const totalNeurons = productionJson.neurons.length +
  productionJson.input;
const totalSynapses = productionJson.synapses.length;
console.log(
  `Production network: ${totalNeurons} neurons, ${totalSynapses} synapses`,
);

const config = createBackPropagationConfig({
  generations: 1,
  learningRate: 0.01,
  plankConstant: 1e-7,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
  disableRandomSamples: true,
  batchSize: 1,
});

const creature = Creature.fromJSON(productionJson);
const sparseConfig = new SparseConfig(productionJson, config);

// Generate random training data.
const input = new Float32Array(productionJson.input);
for (let i = 0; i < input.length; i++) {
  input[i] = random();
}
const target = new Float32Array(productionJson.output);
for (let i = 0; i < target.length; i++) {
  target[i] = random() * 0.5;
}

// Measure initial error.
const initialResult = creature.activate(input);
let initialError = 0;
for (let i = 0; i < target.length; i++) {
  initialError += Math.abs(initialResult[i] - target[i]);
}
console.log(`Initial error: ${initialError.toFixed(6)}`);

Deno.bench(
  "Production-scale backprop (summed gradients)",
  { group: "convergence", baseline: true },
  () => {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  },
);

// After benchmark, measure convergence.
const convergenceCreature = Creature.fromJSON(productionJson);
const convergenceConfig = createBackPropagationConfig({
  generations: 1,
  learningRate: 0.01,
  plankConstant: 1e-7,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
  disableRandomSamples: true,
  batchSize: 1,
});
const convergenceSparse = new SparseConfig(productionJson, convergenceConfig);

const cInitialResult = convergenceCreature.activate(input);
let cInitialError = 0;
for (let i = 0; i < target.length; i++) {
  cInitialError += Math.abs(cInitialResult[i] - target[i]);
}

for (let i = 0; i < 100; i++) {
  convergenceCreature.activateAndTrace(input, false, convergenceSparse);
  convergenceCreature.propagate(target, convergenceConfig, convergenceSparse);
}
convergenceCreature.applyLearnings(convergenceConfig, convergenceSparse);

const cFinalResult = convergenceCreature.activate(input);
let cFinalError = 0;
for (let i = 0; i < target.length; i++) {
  cFinalError += Math.abs(cFinalResult[i] - target[i]);
}

console.log(`\nConvergence test (100 iterations):`);
console.log(`  Initial error: ${cInitialError.toFixed(6)}`);
console.log(`  Final error:   ${cFinalError.toFixed(6)}`);
console.log(
  `  Improvement:   ${((1 - cFinalError / cInitialError) * 100).toFixed(2)}%`,
);
