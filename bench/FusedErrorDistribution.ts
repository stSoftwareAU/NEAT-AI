/**
 * Issue #1377 - Benchmark: Fused backward pass error distribution
 *
 * Compares the performance of:
 * 1. Current approach: separate WASM calls for calculateError + safeZoneAdjustment
 *    + TypeScript distributeElasticError
 * 2. Fused approach: single WASM call that combines all three steps
 *
 * The fused approach eliminates S+1 WASM boundary crossings per neuron and
 * keeps all intermediate float values in WASM linear memory.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/FusedErrorDistribution.ts
 */

import {
  getSquashType,
  initWasmActivation,
  isWasmActivationAvailable,
  wasmCalculateError,
  wasmSafeZoneAdjustmentBatch,
} from "../src/wasm/mod.ts";
import { distributeElasticError } from "../src/propagate/ElasticDistribution.ts";
import { wasmFusedErrorDistribution } from "../src/wasm/WasmStandaloneFunctions.ts";

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
// Benchmark at different synapse counts to show scaling behaviour
// ============================================================================
for (const SYNAPSE_COUNT of [10, 50, 200, 1000]) {
  // Pre-generate test data for a single neuron with SYNAPSE_COUNT inbound synapses
  const neuronSquashType = SQUASH_TYPES[0]; // ReLU for the neuron itself
  const neuronActivation = 0.5;
  const neuronTargetActivation = 0.8;
  const neuronHintValue = 0.3;

  const upstreamSquashTypes = new Uint8Array(SYNAPSE_COUNT);
  const upstreamHintValues = new Float32Array(SYNAPSE_COUNT);
  const upstreamActivations = new Float32Array(SYNAPSE_COUNT);
  const synapseWeights = new Float32Array(SYNAPSE_COUNT);

  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    upstreamSquashTypes[i] =
      SQUASH_TYPES[Math.floor(Math.abs(random()) * SQUASH_TYPES.length)];
    upstreamHintValues[i] = random() * 5;
    upstreamActivations[i] = random();
    synapseWeights[i] = random() * 2;
  }

  const groupName = `fused-error-${SYNAPSE_COUNT}-synapses`;

  // Current approach: separate calls
  Deno.bench({
    name: `Separate (${SYNAPSE_COUNT} synapses)`,
    group: groupName,
    baseline: true,
  }, () => {
    // Step 1: calculateError (1 WASM call)
    const error = wasmCalculateError(
      neuronSquashType,
      neuronActivation,
      neuronTargetActivation,
      neuronHintValue,
    );

    // Step 2: safeZoneAdjustment batch (1 WASM call via batch)
    const safeZoneFactors = wasmSafeZoneAdjustmentBatch(
      upstreamSquashTypes,
      upstreamHintValues,
      error / SYNAPSE_COUNT,
      synapseWeights,
    );

    // Step 3: distributeElasticError (TypeScript)
    const linkMeta = new Array(SYNAPSE_COUNT);
    for (let i = 0; i < SYNAPSE_COUNT; i++) {
      linkMeta[i] = {
        activation: upstreamActivations[i],
        safeZoneFactor: safeZoneFactors[i],
      };
    }
    distributeElasticError(error, linkMeta);
  });

  // Fused approach: single WASM call
  Deno.bench({
    name: `Fused (${SYNAPSE_COUNT} synapses)`,
    group: groupName,
  }, () => {
    wasmFusedErrorDistribution(
      neuronSquashType,
      neuronActivation,
      neuronTargetActivation,
      neuronHintValue,
      upstreamSquashTypes,
      upstreamHintValues,
      upstreamActivations,
      synapseWeights,
    );
  });
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1377: Fused backward pass error distribution");
console.log("=".repeat(70));
console.log(
  "Comparing separate WASM calls + TS elastic distribution vs single fused WASM call.",
);
console.log("Lower is better for each group.\n");
