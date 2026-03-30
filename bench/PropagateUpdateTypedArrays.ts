/**
 * Issue #1661 - Benchmark: Pre-sized typed arrays in propagateUpdate
 *
 * Measures backward pass throughput comparing:
 *   - Baseline: number[] with push() for weight accumulation arrays
 *   - Optimised: Pre-sized Float64Array with direct index assignment
 *
 * Tests small (~44N), medium (~117N), and large (~223N) networks.
 *
 * Run with:
 *   deno bench --allow-read --allow-env --allow-write --allow-ffi bench/PropagateUpdateTypedArrays.ts
 */

import { Creature } from "@creature";
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

const random = seededRandom(1661);

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
  const layerUUIDs: string[][] = [];

  const inputUUIDs = Array.from(
    { length: inputCount },
    (_, i) => `input-${i}`,
  );
  layerUUIDs.push(inputUUIDs);

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
      const connected = new Set<number>();
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

  return { input: inputCount, output: outputCount, neurons, synapses };
}

// Build networks of varying sizes
const smallJSON = buildNetwork(4, 2, [15, 15, 8], 8);
const mediumJSON = buildNetwork(5, 2, [40, 40, 30], 10);
const largeJSON = buildNetwork(10, 3, [60, 60, 50, 40], 12);

const smallCreature = Creature.fromJSON(smallJSON);
const mediumCreature = Creature.fromJSON(mediumJSON);
const largeCreature = Creature.fromJSON(largeJSON);

console.log(
  `Small network: ${smallCreature.neurons.length}N, ${smallCreature.synapses.length}S`,
);
console.log(
  `Medium network: ${mediumCreature.neurons.length}N, ${mediumCreature.synapses.length}S`,
);
console.log(
  `Large network: ${largeCreature.neurons.length}N, ${largeCreature.synapses.length}S`,
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

const smallSparse = new SparseConfig(smallJSON, config);
const mediumSparse = new SparseConfig(mediumJSON, config);
const largeSparse = new SparseConfig(largeJSON, config);

const smallInput = new Float32Array(
  Array.from({ length: 4 }, () => random() * 0.5 + 0.5),
);
const smallTarget = new Float32Array(
  Array.from({ length: 2 }, () => random() * 0.5),
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

// Activate once so traces are available
smallCreature.activateAndTrace(smallInput, false, smallSparse);
mediumCreature.activateAndTrace(mediumInput, false, mediumSparse);
largeCreature.activateAndTrace(largeInput, false, largeSparse);

// ============================================================================
// Full backward pass throughput — measures the propagateUpdate path
// which includes the weight accumulation arrays being optimised.
// ============================================================================

Deno.bench({
  name:
    `Backward pass - small (${smallCreature.neurons.length}N/${smallCreature.synapses.length}S)`,
  group: "backward-pass",
  baseline: true,
}, () => {
  smallCreature.propagate(smallTarget, config, smallSparse);
});

Deno.bench({
  name:
    `Backward pass - medium (${mediumCreature.neurons.length}N/${mediumCreature.synapses.length}S)`,
  group: "backward-pass",
}, () => {
  mediumCreature.propagate(mediumTarget, config, mediumSparse);
});

Deno.bench({
  name:
    `Backward pass - large (${largeCreature.neurons.length}N/${largeCreature.synapses.length}S)`,
  group: "backward-pass",
}, () => {
  largeCreature.propagate(largeTarget, config, largeSparse);
});

// ============================================================================
// Isolated array allocation patterns — push() vs pre-sized Float64Array
// ============================================================================

const ARRAY_SIZE = 50; // representative max inward connection count

// JS number[] with push() (current code pattern)
Deno.bench({
  name: `Array fill - number[] push() (${ARRAY_SIZE} elements)`,
  group: "array-fill",
  baseline: true,
}, () => {
  const arr: number[] = [];
  for (let i = 0; i < ARRAY_SIZE; i++) {
    arr.push(i * 0.123);
  }
  let sum = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) {
    sum += arr[i];
  }
  if (!Number.isFinite(sum)) throw new Error("NaN");
});

// Pre-sized Float64Array with index assignment (proposed change)
Deno.bench({
  name: `Array fill - Float64Array indexed (${ARRAY_SIZE} elements)`,
  group: "array-fill",
}, () => {
  const arr = new Float64Array(ARRAY_SIZE);
  for (let i = 0; i < ARRAY_SIZE; i++) {
    arr[i] = i * 0.123;
  }
  let sum = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) {
    sum += arr[i];
  }
  if (!Number.isFinite(sum)) throw new Error("NaN");
});

// Pre-sized JS number[] with index assignment (alternative)
Deno.bench({
  name: `Array fill - number[] indexed (${ARRAY_SIZE} elements)`,
  group: "array-fill",
}, () => {
  const arr = new Array<number>(ARRAY_SIZE);
  for (let i = 0; i < ARRAY_SIZE; i++) {
    arr[i] = i * 0.123;
  }
  let sum = 0;
  for (let i = 0; i < ARRAY_SIZE; i++) {
    sum += arr[i];
  }
  if (!Number.isFinite(sum)) throw new Error("NaN");
});

console.log("\n" + "=".repeat(70));
console.log(
  "Issue #1661: Pre-sized typed arrays in propagateUpdate weight accumulation",
);
console.log("=".repeat(70));
console.log(
  "Comparing backward pass throughput with push() vs pre-sized Float64Array.",
);
console.log("Lower is better.\n");
