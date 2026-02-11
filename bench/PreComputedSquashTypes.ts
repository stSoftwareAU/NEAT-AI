/**
 * Issue #1378 - Benchmark: Pre-computed squash type indices in creature compilation
 *
 * Measures the overhead of getSquashType() string-to-enum resolution during
 * backpropagation and compares it with pre-computed cached indices.
 *
 * The backward pass calls getSquashType() once per neuron (for the current
 * neuron) and once per inbound synapse (for each upstream neuron). For a
 * network with N neurons and S synapses this adds up to N + S lookups per
 * training sample.
 *
 * This benchmark compares:
 * 1. getSquashType() called per-element (current approach)
 * 2. Pre-computed Uint8Array lookup by neuron index (proposed approach)
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/PreComputedSquashTypes.ts
 */

import { getSquashType, SquashType } from "../src/wasm/SquashType.ts";

const SQUASH_NAMES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "GELU",
  "LeakyReLU",
  "SELU",
  "ELU",
  "Swish",
  "Mish",
  "SOFTSIGN",
  "Softplus",
];

// --- Pre-compute a cache for comparison ---
const preComputedTypes = new Uint8Array(SQUASH_NAMES.length);
for (let i = 0; i < SQUASH_NAMES.length; i++) {
  preComputedTypes[i] = getSquashType(SQUASH_NAMES[i]);
}

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// Simulate a creature with many neurons
for (
  const NEURON_COUNT of [100, 500, 2000]
) {
  const SYNAPSE_COUNT = NEURON_COUNT * 8;
  const random = seededRandom(42);

  // Assign each neuron a squash name (simulates neuron.squash)
  const neuronSquashNames = new Array<string>(NEURON_COUNT);
  for (let i = 0; i < NEURON_COUNT; i++) {
    neuronSquashNames[i] =
      SQUASH_NAMES[Math.floor(random() * SQUASH_NAMES.length)];
  }

  // Pre-computed cache (proposed approach)
  const cachedSquashTypes = new Uint8Array(NEURON_COUNT);
  for (let i = 0; i < NEURON_COUNT; i++) {
    cachedSquashTypes[i] = getSquashType(neuronSquashNames[i]);
  }

  // Simulate synapse from-indices
  const synapseFromIndices = new Uint16Array(SYNAPSE_COUNT);
  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    synapseFromIndices[i] = Math.floor(random() * NEURON_COUNT);
  }

  const groupName = `squash-type-lookup-${NEURON_COUNT}N-${SYNAPSE_COUNT}S`;

  // Baseline: call getSquashType() for each neuron + each synapse's upstream neuron
  Deno.bench({
    name: `getSquashType() per call (${NEURON_COUNT}N/${SYNAPSE_COUNT}S)`,
    group: groupName,
    baseline: true,
  }, () => {
    let sum = 0;
    // Once per neuron
    for (let i = 0; i < NEURON_COUNT; i++) {
      sum += getSquashType(neuronSquashNames[i]);
    }
    // Once per synapse (upstream neuron lookup)
    for (let i = 0; i < SYNAPSE_COUNT; i++) {
      sum += getSquashType(neuronSquashNames[synapseFromIndices[i]]);
    }
    if (sum < 0) throw new Error("unreachable");
  });

  // Proposed: pre-computed Uint8Array indexed by neuron index
  Deno.bench({
    name: `Pre-computed cache (${NEURON_COUNT}N/${SYNAPSE_COUNT}S)`,
    group: groupName,
  }, () => {
    let sum = 0;
    // Once per neuron
    for (let i = 0; i < NEURON_COUNT; i++) {
      sum += cachedSquashTypes[i];
    }
    // Once per synapse (upstream neuron lookup)
    for (let i = 0; i < SYNAPSE_COUNT; i++) {
      sum += cachedSquashTypes[synapseFromIndices[i]];
    }
    if (sum < 0) throw new Error("unreachable");
  });
}

// Also measure the cost of a single getSquashType() call vs Uint8Array read
const singleName = "TANH";
const singleCached = getSquashType(singleName);
const singleArray = new Uint8Array([singleCached]);

Deno.bench({
  name: "Single getSquashType() call",
  group: "single-lookup",
  baseline: true,
}, () => {
  const result = getSquashType(singleName);
  if (result === SquashType.Hypotenuse) throw new Error("unreachable");
});

Deno.bench({
  name: "Single Uint8Array read",
  group: "single-lookup",
}, () => {
  const result = singleArray[0];
  if (result === SquashType.Hypotenuse) throw new Error("unreachable");
});

console.log("\n" + "=".repeat(70));
console.log("Issue #1378: Pre-computed Squash Type Indices");
console.log("=".repeat(70));
console.log("Comparing getSquashType() per-call vs pre-computed Uint8Array.");
console.log("Lower is better for each group.\n");
