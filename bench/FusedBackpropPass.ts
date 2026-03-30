/**
 * Issue #1630 - Benchmark: Fused Backpropagation Pass
 *
 * Measures the full backpropagation pass (forward trace + backward propagation)
 * for networks of varying sizes. This establishes the baseline for investigating
 * whether migrating the entire backprop orchestration loop to Rust/WASM
 * provides a meaningful performance improvement.
 *
 * Network sizes:
 * - Small: ~50 neurons, ~200 synapses (typical early NEAT network)
 * - Medium: ~150 neurons, ~1500 synapses (mid-evolution NEAT network)
 * - Large: ~300 neurons, ~3000 synapses (mature NEAT network)
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/FusedBackpropPass.ts
 */

import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(1630);

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
// Network definitions (sparse connectivity, realistic for NEAT)
// ============================================================================

const smallJSON = buildNetwork(3, 1, [20, 20], 8);
const mediumJSON = buildNetwork(5, 2, [40, 40, 30], 10);
const largeJSON = buildNetwork(10, 3, [60, 60, 50, 40], 12);

// Create creatures once outside bench loop
const smallCreature = Creature.fromJSON(smallJSON);
const mediumCreature = Creature.fromJSON(mediumJSON);
const largeCreature = Creature.fromJSON(largeJSON);

console.log(
  `Small network: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `Medium network: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large network: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

// Pre-generate input and target data
const smallInput = new Float32Array(
  Array.from({ length: 3 }, () => random() * 0.5 + 0.5),
);
const smallTarget = new Float32Array(
  Array.from({ length: 1 }, () => random() * 0.5),
);

const mediumInput = new Float32Array(
  Array.from({ length: 5 }, () => random() * 0.5 + 0.5),
);
const mediumTarget = new Float32Array(
  Array.from({ length: 2 }, () => random() * 0.5),
);

const largeInput = new Float32Array(
  Array.from({ length: 10 }, () => random() * 0.5 + 0.5),
);
const largeTarget = new Float32Array(
  Array.from({ length: 3 }, () => random() * 0.5),
);

// Create backprop configs
const config = createBackPropagationConfig({
  generations: 5,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
  disableRandomSamples: true,
  batchSize: 64,
});

// Create sparse configs (full backprop, no sparse selection)
const smallSparse = new SparseConfig(smallJSON, config);
const mediumSparse = new SparseConfig(mediumJSON, config);
const largeSparse = new SparseConfig(largeJSON, config);

// ============================================================================
// Benchmark: Full backprop pass (activate + trace + propagate) per sample
// ============================================================================

Deno.bench({
  name:
    `Full backprop - small (${smallCreature.neurons.length}N/${smallCreature.synapses.length}S)`,
  group: "full-backprop-pass",
  baseline: true,
}, () => {
  smallCreature.activateAndTrace(smallInput, false, smallSparse);
  smallCreature.propagate(smallTarget, config, smallSparse);
});

Deno.bench({
  name:
    `Full backprop - medium (${mediumCreature.neurons.length}N/${mediumCreature.synapses.length}S)`,
  group: "full-backprop-pass",
}, () => {
  mediumCreature.activateAndTrace(mediumInput, false, mediumSparse);
  mediumCreature.propagate(mediumTarget, config, mediumSparse);
});

Deno.bench({
  name:
    `Full backprop - large (${largeCreature.neurons.length}N/${largeCreature.synapses.length}S)`,
  group: "full-backprop-pass",
}, () => {
  largeCreature.activateAndTrace(largeInput, false, largeSparse);
  largeCreature.propagate(largeTarget, config, largeSparse);
});

// ============================================================================
// Benchmark: Propagation only (backward pass, no forward trace)
// ============================================================================

const smallPropCreature = Creature.fromJSON(smallJSON);
const mediumPropCreature = Creature.fromJSON(mediumJSON);
const largePropCreature = Creature.fromJSON(largeJSON);

smallPropCreature.activateAndTrace(smallInput, false, smallSparse);
mediumPropCreature.activateAndTrace(mediumInput, false, mediumSparse);
largePropCreature.activateAndTrace(largeInput, false, largeSparse);

Deno.bench({
  name: `Propagate only - small (${smallPropCreature.neurons.length}N)`,
  group: "propagate-only",
  baseline: true,
}, () => {
  smallPropCreature.propagate(smallTarget, config, smallSparse);
});

Deno.bench({
  name: `Propagate only - medium (${mediumPropCreature.neurons.length}N)`,
  group: "propagate-only",
}, () => {
  mediumPropCreature.propagate(mediumTarget, config, mediumSparse);
});

Deno.bench({
  name: `Propagate only - large (${largePropCreature.neurons.length}N)`,
  group: "propagate-only",
}, () => {
  largePropCreature.propagate(largeTarget, config, largeSparse);
});

// ============================================================================
// Benchmark: Propagate breakdown (with vs without weight/bias accumulation)
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

const mediumNoAccCreature = Creature.fromJSON(mediumJSON);
const mediumNoAccSparse = new SparseConfig(mediumJSON, noAccumulateConfig);
mediumNoAccCreature.activateAndTrace(
  mediumInput,
  false,
  mediumNoAccSparse,
);

Deno.bench({
  name:
    `Propagate (error only) - medium (${mediumNoAccCreature.neurons.length}N)`,
  group: "propagate-breakdown",
  baseline: true,
}, () => {
  mediumNoAccCreature.propagate(
    mediumTarget,
    noAccumulateConfig,
    mediumNoAccSparse,
  );
});

Deno.bench({
  name: `Propagate (full) - medium (${mediumPropCreature.neurons.length}N)`,
  group: "propagate-breakdown",
}, () => {
  mediumPropCreature.propagate(mediumTarget, config, mediumSparse);
});

console.log("\n" + "=".repeat(70));
console.log("Issue #1630: Fused Backpropagation Pass Benchmark");
console.log("=".repeat(70));
console.log(
  "Measuring full backprop pass for different network sizes.",
);
console.log(
  "This establishes the baseline before investigating Rust/WASM migration.",
);
console.log("Lower is better.\n");
