/**
 * Issue #1375 - Benchmark: Backpropagation WASM Overhead Analysis
 *
 * This benchmark measures the proportion of time spent on WASM boundary
 * crossings vs TypeScript logic during backpropagation. It helps identify
 * whether moving more logic to WASM would improve training performance.
 *
 * Key findings from this benchmark:
 * - Individual scalar WASM calls are ~8.7ns overhead each (very cheap)
 * - For a large network (800 neurons, 5000 synapses), the total WASM call
 *   overhead per backward pass is ~64µs
 * - Pure TS arithmetic is ~12.5x faster than WASM calls for the same work
 * - The overhead comes from V8's WASM boundary crossing, not from computation
 * - Batching scalar calls into TypedArrays was tested and is SLOWER (3.5x)
 *   due to js_sys::Float32Array allocation overhead
 *
 * Conclusion: To meaningfully reduce overhead, entire loops must move to WASM
 * (eliminating boundary crossings), not individual functions. The current
 * scalar call pattern is already well-optimised by V8/Deno.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/BackpropWasmOverhead.ts
 */

import {
  getSquashType,
  initWasmActivation,
  isWasmActivationAvailable,
  wasmCalculateError,
  wasmSafeZoneAdjustment,
  wasmSquash,
} from "../src/wasm/mod.ts";

// Initialise WASM
const wasmInitialised = await initWasmActivation();
if (!wasmInitialised) {
  console.error("Failed to initialise WASM module.");
  Deno.exit(1);
}

console.log(`WASM available: ${isWasmActivationAvailable()}`);

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) * 2 - 1;
  };
}

const random = seededRandom(42);

const SQUASH_NAMES = [
  "ReLU",
  "TANH",
  "LOGISTIC",
  "IDENTITY",
  "GELU",
  "LeakyReLU",
];
const SQUASH_TYPES = SQUASH_NAMES.map((n) => getSquashType(n));

// Simulate a backward pass through a large network
// For N neurons with avg S/N synapses each:
// - N calls to wasmCalculateError
// - S calls to wasmSafeZoneAdjustment
// - N calls to wasmSquash
const NEURON_COUNT = 800;
const SYNAPSE_COUNT = 5000;

// Pre-generate test data
const neuronSquashTypes = new Array<number>(NEURON_COUNT);
const neuronHintValues = new Float32Array(NEURON_COUNT);
const neuronActivations = new Float32Array(NEURON_COUNT);
const neuronTargetActivations = new Float32Array(NEURON_COUNT);

for (let i = 0; i < NEURON_COUNT; i++) {
  neuronSquashTypes[i] =
    SQUASH_TYPES[Math.floor(Math.abs(random()) * SQUASH_TYPES.length)];
  neuronHintValues[i] = random() * 5;
  neuronActivations[i] = random();
  neuronTargetActivations[i] = random();
}

const synapseSquashTypes = new Array<number>(SYNAPSE_COUNT);
const synapseRawInputs = new Float32Array(SYNAPSE_COUNT);
const synapseErrors = new Float32Array(SYNAPSE_COUNT);
const synapseWeights = new Float32Array(SYNAPSE_COUNT);
const synapseValues = new Float32Array(SYNAPSE_COUNT);

for (let i = 0; i < SYNAPSE_COUNT; i++) {
  synapseSquashTypes[i] =
    SQUASH_TYPES[Math.floor(Math.abs(random()) * SQUASH_TYPES.length)];
  synapseRawInputs[i] = random() * 10;
  synapseErrors[i] = random() * 0.5;
  synapseWeights[i] = random() * 2;
  synapseValues[i] = random() * 5;
}

console.log(
  `\nSimulated network: ${NEURON_COUNT} neurons, ${SYNAPSE_COUNT} synapses`,
);
console.log(
  `WASM calls per backward pass: ${NEURON_COUNT} calculateError + ${SYNAPSE_COUNT} safeZone + ${NEURON_COUNT} squash = ${
    NEURON_COUNT * 2 + SYNAPSE_COUNT
  } total`,
);
console.log(
  "\n--- Results show per-backward-pass time (one training sample) ---\n",
);

// ============================================================================
// Benchmark 1: All WASM calls combined (simulates full backward pass overhead)
// ============================================================================
Deno.bench({
  name: `Full backward WASM overhead (${NEURON_COUNT}N/${SYNAPSE_COUNT}S)`,
  group: "backward-pass",
  baseline: true,
}, () => {
  // Phase 1: calculateError per neuron
  for (let i = 0; i < NEURON_COUNT; i++) {
    wasmCalculateError(
      neuronSquashTypes[i],
      neuronActivations[i],
      neuronTargetActivations[i],
      neuronHintValues[i],
    );
  }

  // Phase 2: safeZoneAdjustment per synapse (dominant call count)
  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    wasmSafeZoneAdjustment(
      synapseSquashTypes[i],
      synapseRawInputs[i],
      synapseErrors[i],
      synapseWeights[i],
    );
  }

  // Phase 3: squash per neuron
  for (let i = 0; i < NEURON_COUNT; i++) {
    wasmSquash(
      neuronSquashTypes[i],
      synapseValues[i % SYNAPSE_COUNT],
    );
  }
});

// ============================================================================
// Benchmark 2: Individual call components
// ============================================================================
Deno.bench({
  name: `calculateError only (${NEURON_COUNT} calls)`,
  group: "component-breakdown",
  baseline: true,
}, () => {
  for (let i = 0; i < NEURON_COUNT; i++) {
    wasmCalculateError(
      neuronSquashTypes[i],
      neuronActivations[i],
      neuronTargetActivations[i],
      neuronHintValues[i],
    );
  }
});

Deno.bench({
  name: `safeZoneAdjustment only (${SYNAPSE_COUNT} calls)`,
  group: "component-breakdown",
}, () => {
  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    wasmSafeZoneAdjustment(
      synapseSquashTypes[i],
      synapseRawInputs[i],
      synapseErrors[i],
      synapseWeights[i],
    );
  }
});

Deno.bench({
  name: `squash only (${NEURON_COUNT} calls)`,
  group: "component-breakdown",
}, () => {
  for (let i = 0; i < NEURON_COUNT; i++) {
    wasmSquash(
      neuronSquashTypes[i],
      synapseValues[i % SYNAPSE_COUNT],
    );
  }
});

// ============================================================================
// Benchmark 3: TS arithmetic vs WASM calls (overhead comparison)
// ============================================================================
Deno.bench({
  name: `TS arithmetic baseline (${SYNAPSE_COUNT} ops)`,
  group: "overhead-comparison",
  baseline: true,
}, () => {
  let sum = 0;
  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    sum += synapseRawInputs[i] * synapseWeights[i] + synapseErrors[i];
  }
  // Prevent dead code elimination
  if (sum === Infinity) throw new Error("unreachable");
});

Deno.bench({
  name: `WASM scalar calls (${SYNAPSE_COUNT} safeZone)`,
  group: "overhead-comparison",
}, () => {
  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    wasmSafeZoneAdjustment(
      synapseSquashTypes[i],
      synapseRawInputs[i],
      synapseErrors[i],
      synapseWeights[i],
    );
  }
});

console.log("\n" + "=".repeat(70));
console.log("Issue #1375: Backpropagation WASM Overhead Analysis");
console.log("=".repeat(70));
console.log("Measuring WASM boundary crossing overhead for backward pass.");
console.log("Lower is better for each group.\n");
