/**
 * Issue #1952 - Benchmark: Production-scale backpropagation baseline
 *
 * Measures the full backpropagation pass (forward trace + backward propagation)
 * for a production-scale network: 1,164+ hidden neurons and 19,039+ synapses.
 * This establishes the baseline for evaluating whether further TS → Rust/WASM
 * migration yields meaningful gains (part of #1951).
 *
 * Network size:
 * - Production: ~1,164 hidden neurons across multiple layers, ~19,039 synapses
 *   with realistic sparse connectivity
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/ProductionScaleBackprop.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(1952);

const SQUASH_NAMES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "GELU",
  "LeakyReLU",
];

/**
 * Build a sparsely connected feed-forward network.
 * Each neuron connects to a limited number of neurons in the next layer
 * (controlled by maxFanOut), simulating realistic NEAT topology.
 */
function buildNetwork(
  inputCount: number,
  outputCount: number,
  hiddenLayers: number[],
  maxFanOut: number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  const layerUUIDs: string[][] = [];

  // Input layer UUIDs
  const inputUUIDs = Array.from(
    { length: inputCount },
    (_, i) => `input-${i}`,
  );
  layerUUIDs.push(inputUUIDs);

  // Hidden layers
  for (let layerIdx = 0; layerIdx < hiddenLayers.length; layerIdx++) {
    const layerSize = hiddenLayers[layerIdx];
    const uuids: string[] = [];
    for (let i = 0; i < layerSize; i++) {
      const uuid = `hidden-${layerIdx}-${i}`;
      uuids.push(uuid);
      neurons.push({
        type: "hidden",
        uuid,
        squash: SQUASH_NAMES[
          Math.floor(Math.abs(random()) * SQUASH_NAMES.length)
        ],
        bias: random() * 0.5,
      });
    }
    layerUUIDs.push(uuids);
  }

  // Output layer
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

  // Connect consecutive layers with sparse connectivity
  for (let l = 0; l < layerUUIDs.length - 1; l++) {
    const fromLayer = layerUUIDs[l];
    const toLayer = layerUUIDs[l + 1];
    for (const fromUUID of fromLayer) {
      // Each source connects to at most maxFanOut targets
      const fanOut = Math.min(maxFanOut, toLayer.length);
      const connected = new Set<number>();
      // Always connect to at least one target
      while (connected.size < fanOut) {
        const targetIdx = Math.floor(
          Math.abs(random()) * toLayer.length,
        );
        if (!connected.has(targetIdx)) {
          connected.add(targetIdx);
          synapses.push({
            fromUUID,
            toUUID: toLayer[targetIdx],
            weight: random() * 0.5,
          });
        }
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

// ============================================================================
// Production-scale network definition
// Target: ~1,164 hidden neurons, ~19,039 synapses
//
// Layer sizes: [200, 250, 250, 200, 150, 114] = 1,164 hidden neurons
// With 8 inputs, 4 outputs, and maxFanOut=16, this produces ~19,000+ synapses
// ============================================================================

const INPUT_COUNT = 8;
const OUTPUT_COUNT = 4;
const HIDDEN_LAYERS = [200, 250, 250, 200, 150, 114];
const MAX_FAN_OUT = 18;

const productionJSON = buildNetwork(
  INPUT_COUNT,
  OUTPUT_COUNT,
  HIDDEN_LAYERS,
  MAX_FAN_OUT,
);

const productionCreature = Creature.fromJSON(productionJSON);

const totalHidden =
  productionCreature.neurons.filter((n) => n.type === "hidden").length;
const totalNeurons = productionCreature.neurons.length;
const totalSynapses = productionCreature.synapses.length;

console.log("\n" + "=".repeat(70));
console.log("Issue #1952: Production-scale Backpropagation Baseline");
console.log("=".repeat(70));
console.log(`Network: ${totalNeurons} neurons (${totalHidden} hidden)`);
console.log(`Synapses: ${totalSynapses}`);
console.log(
  `Layers: input(${INPUT_COUNT}) → ${
    HIDDEN_LAYERS.join(" → ")
  } → output(${OUTPUT_COUNT})`,
);
console.log("=".repeat(70));

// Pre-generate input and target data
const productionInput = new Float32Array(
  Array.from({ length: INPUT_COUNT }, () => random() * 0.5 + 0.5),
);
const productionTarget = new Float32Array(
  Array.from({ length: OUTPUT_COUNT }, () => random() * 0.5),
);

// Create backprop config
const config = createBackPropagationConfig({
  generations: 5,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
  disableRandomSamples: true,
  batchSize: 64,
});

const productionSparse = new SparseConfig(productionJSON, config);

// ============================================================================
// Benchmark: Full backprop pass (activate + trace + propagate) per sample
// ============================================================================

Deno.bench({
  name: `Full backprop - production (${totalNeurons}N/${totalSynapses}S)`,
  group: "production-full-backprop",
  baseline: true,
}, () => {
  productionCreature.activateAndTrace(
    productionInput,
    false,
    productionSparse,
  );
  productionCreature.propagate(productionTarget, config, productionSparse);
});

// ============================================================================
// Benchmark: Propagation only (backward pass)
// ============================================================================

const propagateCreature = Creature.fromJSON(productionJSON);
propagateCreature.activateAndTrace(
  productionInput,
  false,
  productionSparse,
);

Deno.bench({
  name: `Propagate only - production (${totalNeurons}N/${totalSynapses}S)`,
  group: "production-propagate-only",
  baseline: true,
}, () => {
  propagateCreature.propagate(productionTarget, config, productionSparse);
});

// ============================================================================
// Benchmark: Activation only (forward pass)
// ============================================================================

const activateCreature = Creature.fromJSON(productionJSON);

Deno.bench({
  name: `Activate only - production (${totalNeurons}N/${totalSynapses}S)`,
  group: "production-activate-only",
  baseline: true,
}, () => {
  activateCreature.activateAndTrace(
    productionInput,
    false,
    productionSparse,
  );
});

// ============================================================================
// Benchmark: Propagation breakdown (error only vs full accumulation)
// ============================================================================

const noAccumulateConfig = createBackPropagationConfig({
  generations: 5,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
  disableRandomSamples: true,
  disableWeightAdjustment: true,
  disableBiasAdjustment: true,
  batchSize: 64,
});

const errorOnlyCreature = Creature.fromJSON(productionJSON);
const errorOnlySparse = new SparseConfig(productionJSON, noAccumulateConfig);
errorOnlyCreature.activateAndTrace(
  productionInput,
  false,
  errorOnlySparse,
);

Deno.bench({
  name:
    `Propagate (error only) - production (${totalNeurons}N/${totalSynapses}S)`,
  group: "production-propagate-breakdown",
  baseline: true,
}, () => {
  errorOnlyCreature.propagate(
    productionTarget,
    noAccumulateConfig,
    errorOnlySparse,
  );
});

Deno.bench({
  name: `Propagate (full) - production (${totalNeurons}N/${totalSynapses}S)`,
  group: "production-propagate-breakdown",
}, () => {
  propagateCreature.propagate(productionTarget, config, productionSparse);
});

console.log(
  "\nMeasuring production-scale backprop pass.",
);
console.log(
  "This establishes the baseline for evaluating Rust/WASM migration gains.",
);
console.log("Lower is better.\n");
