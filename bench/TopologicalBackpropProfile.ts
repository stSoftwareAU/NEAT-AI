/**
 * Issue #1657 - Profile: Topological Backpropagation Orchestration Loop
 *
 * Instruments the iterative topological backpropagation loop to measure
 * where time is spent across the different phases:
 *
 * 1. Topological order computation
 * 2. JS object property lookups and state access
 * 3. Buffer preparation (building typed arrays for WASM)
 * 4. WASM calls (fusedErrorDistribution, wasmSquash)
 * 5. Error distribution and upstream accumulation
 * 6. Weight/bias accumulation
 *
 * This determines whether JS overhead is significant enough to justify
 * migrating the entire orchestration loop to Rust/WASM.
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-write --allow-ffi bench/TopologicalBackpropProfile.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { computeReverseTopologicalOrder } from "@propagate/TopologicalOrder.ts";
import {
  fusedErrorDistribution,
  squash as wasmSquash,
} from "@wasm/ActivationMethods.ts";
import { adjustedActivation } from "@neuron/NeuronPropagation.ts";
import { adjustedBias } from "@propagate/Bias.ts";
import { adjustedWeight } from "@propagate/Weight.ts";
import { BackpropBuffers } from "@propagate/BackpropBuffers.ts";

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(1657);

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
 */
function buildNetwork(
  inputCount: number,
  outputCount: number,
  hiddenLayers: number[],
  maxFanOut: number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const layerIds: number[][] = [];

  const inputIds = Array.from(
    { length: inputCount },
    (_, i) => i,
  );
  layerIds.push(inputIds);

  let nextHiddenId = 100;
  for (let layerIdx = 0; layerIdx < hiddenLayers.length; layerIdx++) {
    const layerSize = hiddenLayers[layerIdx];
    const ids: number[] = [];
    for (let i = 0; i < layerSize; i++) {
      const id = nextHiddenId++;
      ids.push(id);
      neurons.push({
        type: "hidden",
        id,
        squash: SQUASH_NAMES[
          Math.floor(Math.abs(random()) * SQUASH_NAMES.length)
        ],
        bias: random() * 0.5,
      });
    }
    layerIds.push(ids);
  }

  const outputIds: number[] = [];
  for (let i = 0; i < outputCount; i++) {
    const id = -(i + 1);
    outputIds.push(id);
    neurons.push({
      type: "output",
      id,
      squash: "IDENTITY",
      bias: random() * 0.1,
    });
  }
  layerIds.push(outputIds);

  for (let l = 0; l < layerIds.length - 1; l++) {
    const fromLayer = layerIds[l];
    const toLayer = layerIds[l + 1];
    for (const fromId of fromLayer) {
      const fanOut = Math.min(maxFanOut, toLayer.length);
      const connected = new Set<number>();
      while (connected.size < fanOut) {
        const targetIdx = Math.floor(
          Math.abs(random()) * toLayer.length,
        );
        if (!connected.has(targetIdx)) {
          connected.add(targetIdx);
          synapses.push({
            fromId,
            toId: toLayer[targetIdx],
            weight: random() * 0.5,
          });
        }
      }
    }
  }

  return { input: inputCount, output: outputCount, neurons, synapses };
}

// Build a medium network for profiling (representative size)
const mediumJSON = buildNetwork(5, 2, [40, 40, 30], 10);
const mediumCreature = Creature.fromJSON(mediumJSON);

// Large network closer to production scale
const largeJSON = buildNetwork(10, 3, [60, 60, 50, 40], 12);
const largeCreature = Creature.fromJSON(largeJSON);

console.log(
  `Medium network: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large network: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

const config = createBackPropagationConfig({
  generations: 5,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
  maximumWeightAdjustmentScale: 1,
  maximumBiasAdjustmentScale: 1,
  disableRandomSamples: true,
  batchSize: 64,
});

const mediumSparse = new SparseConfig(mediumJSON, config);
const largeSparse = new SparseConfig(largeJSON, config);

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

// Activate once so traces are available for profiling
mediumCreature.activateAndTrace(mediumInput, false, mediumSparse);
largeCreature.activateAndTrace(largeInput, false, largeSparse);

// ============================================================================
// Profiling: Isolate individual components
// ============================================================================

// 1. Topological order computation
Deno.bench({
  name: `Topological order - medium (${mediumCreature.neurons.length}N)`,
  group: "topo-order",
  baseline: true,
}, () => {
  computeReverseTopologicalOrder(mediumCreature);
});

Deno.bench({
  name: `Topological order - large (${largeCreature.neurons.length}N)`,
  group: "topo-order",
}, () => {
  computeReverseTopologicalOrder(largeCreature);
});

// 2. State lookups and adjusted values (JS overhead)
Deno.bench({
  name: `adjustedActivation calls - medium`,
  group: "js-overhead",
  baseline: true,
}, () => {
  const neurons = mediumCreature.neurons;
  for (let i = mediumCreature.input; i < neurons.length; i++) {
    adjustedActivation(neurons[i], config);
  }
});

Deno.bench({
  name: `adjustedWeight+adjustedBias calls - medium`,
  group: "js-overhead",
}, () => {
  const neurons = mediumCreature.neurons;
  const state = mediumCreature.state;
  for (let i = mediumCreature.input; i < neurons.length; i++) {
    adjustedBias(neurons[i], config);
    const inward = mediumCreature.inwardConnections(i);
    for (let j = 0; j < inward.length; j++) {
      adjustedWeight(state, inward[j], config);
    }
  }
});

// 3. Buffer preparation (building typed arrays)
Deno.bench({
  name: `Buffer acquire+fill+release - medium`,
  group: "buffer-ops",
  baseline: true,
}, () => {
  const buffers = new BackpropBuffers();
  const neurons = mediumCreature.neurons;
  for (let i = mediumCreature.input; i < neurons.length; i++) {
    const inward = mediumCreature.inwardConnections(i);
    if (inward.length > 0) {
      const buf = buffers.acquire(inward.length);
      // Simulate filling buffers
      for (let j = 0; j < inward.length; j++) {
        buf.fusedActivations[j] = 0.5;
        buf.fusedWeights[j] = 0.3;
        buf.fusedSquashTypes[j] = 0;
        buf.fusedHintValues[j] = 0;
      }
      buffers.release(buf);
    }
  }
});

// 4. WASM calls (fusedErrorDistribution) — isolated
const _testActivations = new Float32Array([0.5, 0.3, 0.7]);
const _testWeights = new Float32Array([0.2, -0.4, 0.6]);
const _testSquashTypes = new Uint8Array([0, 0, 0]); // Identity
const _testHints = new Float32Array([0, 0, 0]);

Deno.bench({
  name: `fusedErrorDistribution WASM call - 3 connections`,
  group: "wasm-calls",
  baseline: true,
}, () => {
  fusedErrorDistribution(
    0, // Identity
    0.5, // activation
    0.6, // targetActivation
    0, // hintValue
    _testSquashTypes,
    _testHints,
    _testActivations,
    _testWeights,
  );
});

const _testActivations10 = new Float32Array(10).fill(0.5);
const _testWeights10 = new Float32Array(10).fill(0.3);
const _testSquashTypes10 = new Uint8Array(10);
const _testHints10 = new Float32Array(10);

Deno.bench({
  name: `fusedErrorDistribution WASM call - 10 connections`,
  group: "wasm-calls",
}, () => {
  fusedErrorDistribution(
    0,
    0.5,
    0.6,
    0,
    _testSquashTypes10,
    _testHints10,
    _testActivations10,
    _testWeights10,
  );
});

Deno.bench({
  name: `wasmSquash call (single)`,
  group: "wasm-calls",
}, () => {
  wasmSquash("TANH", 0.5);
});

// 5. Full propagation (for comparison)
Deno.bench({
  name: `Full propagate - medium (${mediumCreature.neurons.length}N)`,
  group: "full-propagate",
  baseline: true,
}, () => {
  mediumCreature.propagate(mediumTarget, config, mediumSparse);
});

Deno.bench({
  name: `Full propagate - large (${largeCreature.neurons.length}N)`,
  group: "full-propagate",
}, () => {
  largeCreature.propagate(largeTarget, config, largeSparse);
});

// 6. inwardConnections lookup (graph structure access)
Deno.bench({
  name: `inwardConnections lookups - medium`,
  group: "graph-access",
  baseline: true,
}, () => {
  for (let i = mediumCreature.input; i < mediumCreature.neurons.length; i++) {
    mediumCreature.inwardConnections(i);
  }
});

Deno.bench({
  name: `inwardConnections lookups - large`,
  group: "graph-access",
}, () => {
  for (let i = largeCreature.input; i < largeCreature.neurons.length; i++) {
    largeCreature.inwardConnections(i);
  }
});

// 7. sparseConfig.propagateNeeded lookups
Deno.bench({
  name: `propagateNeeded lookups - medium`,
  group: "sparse-checks",
  baseline: true,
}, () => {
  const neurons = mediumCreature.neurons;
  for (let i = mediumCreature.input; i < neurons.length; i++) {
    mediumSparse.propagateNeeded(neurons[i].id);
  }
});

Deno.bench({
  name: `propagateNeeded lookups - large`,
  group: "sparse-checks",
}, () => {
  const neurons = largeCreature.neurons;
  for (let i = largeCreature.input; i < neurons.length; i++) {
    largeSparse.propagateNeeded(neurons[i].id);
  }
});

console.log("\n" + "=".repeat(70));
console.log("Issue #1657: Topological Backprop Profiling Benchmark");
console.log("=".repeat(70));
console.log(
  "Measuring time distribution across orchestration loop components.",
);
console.log(
  "Determines whether JS overhead justifies WASM migration.",
);
console.log("Lower is better.\n");
