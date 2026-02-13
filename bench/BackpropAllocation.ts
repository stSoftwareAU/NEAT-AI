/**
 * Issue #1379 - Benchmark: Backward pass TypeScript allocation overhead
 *
 * Measures the cost of allocating temporary arrays in the backward pass inner
 * loop vs reusing pre-allocated buffers. The backward pass allocates 8 arrays
 * per neuron per training sample; for a network with 800 neurons this creates
 * ~6400 temporary arrays per sample.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/BackpropAllocation.ts
 */

import {
  getSquashType,
  initWasmActivation,
  isWasmActivationAvailable,
} from "../src/wasm/mod.ts";
import { wasmFusedErrorDistribution } from "../src/wasm/WasmStandaloneFunctions.ts";
import { BackpropBuffers } from "../src/propagate/BackpropBuffers.ts";

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

// ============================================================================
// Simulate a full backward pass through a realistic network.
// For each neuron we allocate 8 scratch arrays, populate them, then call
// the fused WASM function.  This captures the allocation pattern from
// Neuron.propagate() lines 663-671.
// ============================================================================

const NEURON_COUNT = 800;
const MAX_INWARD = 20; // realistic max inward connections per neuron

// Pre-generate per-neuron inward connection counts (variable lengths)
const inwardCounts = new Array<number>(NEURON_COUNT);
for (let i = 0; i < NEURON_COUNT; i++) {
  inwardCounts[i] = Math.max(1, Math.floor(Math.abs(random()) * MAX_INWARD));
}

// Pre-generate upstream data for every synapse of every neuron
const neuronSquashType = SQUASH_TYPES[0]; // ReLU for each neuron
const neuronActivation = 0.5;
const neuronTarget = 0.8;
const neuronHint = 0.3;

const allUpstreamSquash: number[][] = [];
const allUpstreamHint: number[][] = [];
const allUpstreamActivation: number[][] = [];
const allUpstreamWeight: number[][] = [];

for (let n = 0; n < NEURON_COUNT; n++) {
  const len = inwardCounts[n];
  const sq = new Array<number>(len);
  const hi = new Array<number>(len);
  const ac = new Array<number>(len);
  const we = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    sq[i] = SQUASH_TYPES[Math.floor(Math.abs(random()) * SQUASH_TYPES.length)];
    hi[i] = random() * 5;
    ac[i] = random();
    we[i] = random() * 2;
  }
  allUpstreamSquash.push(sq);
  allUpstreamHint.push(hi);
  allUpstreamActivation.push(ac);
  allUpstreamWeight.push(we);
}

// ============================================================================
// Baseline: allocate fresh arrays per neuron (current code path)
// ============================================================================
Deno.bench({
  name: `Fresh allocation per neuron (${NEURON_COUNT}N)`,
  group: "backprop-allocation",
  baseline: true,
}, () => {
  for (let n = 0; n < NEURON_COUNT; n++) {
    const len = inwardCounts[n];

    // Allocate 8 arrays (mirrors Neuron.propagate lines 663-671)
    const fromActivationCache = new Array<number>(len);
    const fromWeightCache = new Array<number>(len);
    const fromValueCache = new Array<number>(len);
    const safeZoneFactorCache = new Array<number>(len);

    const fusedSquashTypes = new Uint8Array(len);
    const fusedHintValues = new Float32Array(len);
    const fusedActivations = new Float32Array(len);
    const fusedWeights = new Float32Array(len);

    // Populate (mirrors the cache-filling loop)
    const srcSq = allUpstreamSquash[n];
    const srcHi = allUpstreamHint[n];
    const srcAc = allUpstreamActivation[n];
    const srcWe = allUpstreamWeight[n];
    for (let i = 0; i < len; i++) {
      fromActivationCache[i] = srcAc[i];
      fromWeightCache[i] = srcWe[i];
      fromValueCache[i] = srcAc[i] * srcWe[i];
      safeZoneFactorCache[i] = 1;
      fusedSquashTypes[i] = srcSq[i];
      fusedHintValues[i] = srcHi[i];
      fusedActivations[i] = srcAc[i];
      fusedWeights[i] = srcWe[i];
    }

    // Call fused WASM (mirrors the actual computation)
    wasmFusedErrorDistribution(
      neuronSquashType,
      neuronActivation,
      neuronTarget,
      neuronHint,
      fusedSquashTypes,
      fusedHintValues,
      fusedActivations,
      fusedWeights,
    );
  }
});

// ============================================================================
// Optimised: reuse pre-allocated buffers via BackpropBuffers
// ============================================================================
const buffers = new BackpropBuffers(MAX_INWARD);

Deno.bench({
  name: `Reused buffers per neuron (${NEURON_COUNT}N)`,
  group: "backprop-allocation",
}, () => {
  for (let n = 0; n < NEURON_COUNT; n++) {
    const len = inwardCounts[n];

    const buf = buffers.acquire(len);

    // Populate (identical logic)
    const srcSq = allUpstreamSquash[n];
    const srcHi = allUpstreamHint[n];
    const srcAc = allUpstreamActivation[n];
    const srcWe = allUpstreamWeight[n];
    for (let i = 0; i < len; i++) {
      buf.fromActivationCache[i] = srcAc[i];
      buf.fromWeightCache[i] = srcWe[i];
      buf.fromValueCache[i] = srcAc[i] * srcWe[i];
      buf.safeZoneFactorCache[i] = 1;
      buf.fusedSquashTypes[i] = srcSq[i];
      buf.fusedHintValues[i] = srcHi[i];
      buf.fusedActivations[i] = srcAc[i];
      buf.fusedWeights[i] = srcWe[i];
    }

    // Call fused WASM (mirrors the actual computation)
    wasmFusedErrorDistribution(
      neuronSquashType,
      neuronActivation,
      neuronTarget,
      neuronHint,
      buf.fusedSquashTypes.subarray(0, len),
      buf.fusedHintValues.subarray(0, len),
      buf.fusedActivations.subarray(0, len),
      buf.fusedWeights.subarray(0, len),
    );

    buffers.release(buf);
  }
});

console.log("\n" + "=".repeat(70));
console.log("Issue #1379: Backward pass TypeScript allocation overhead");
console.log("=".repeat(70));
console.log(
  `Simulated ${NEURON_COUNT} neurons, max ${MAX_INWARD} inward connections.`,
);
console.log(
  "Baseline allocates 8 fresh arrays per neuron; optimised reuses pre-allocated buffers.",
);
console.log("Lower is better.\n");
