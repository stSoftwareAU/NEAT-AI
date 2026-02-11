/**
 * Issue #1376 - Benchmark: Batch vs Scalar safe zone adjustment
 *
 * Compares the performance of:
 * 1. Individual scalar WASM calls (S calls per neuron backward pass)
 * 2. Single batch WASM call (1 call per neuron backward pass)
 *
 * The batch approach eliminates S-1 WASM boundary crossings per neuron,
 * where each crossing costs ~8.7ns of overhead.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/SafeZoneBatch.ts
 */

import {
  getSquashType,
  initWasmActivation,
  isWasmActivationAvailable,
  wasmSafeZoneAdjustment,
  wasmSafeZoneAdjustmentBatch,
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

// ============================================================================
// Benchmark at different synapse counts to show scaling behaviour
// ============================================================================
for (const SYNAPSE_COUNT of [10, 50, 200, 1000, 5000]) {
  // Pre-generate test data
  const squashTypesArray = new Uint8Array(SYNAPSE_COUNT);
  const rawInputsArray = new Float32Array(SYNAPSE_COUNT);
  const weightsArray = new Float32Array(SYNAPSE_COUNT);
  const provisionalError = 0.1;

  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    squashTypesArray[i] =
      SQUASH_TYPES[Math.floor(Math.abs(random()) * SQUASH_TYPES.length)];
    rawInputsArray[i] = random() * 10;
    weightsArray[i] = random() * 2;
  }

  const groupName = `safe-zone-${SYNAPSE_COUNT}-synapses`;

  // Scalar: S individual WASM calls
  Deno.bench({
    name: `Scalar (${SYNAPSE_COUNT} calls)`,
    group: groupName,
    baseline: true,
  }, () => {
    for (let i = 0; i < SYNAPSE_COUNT; i++) {
      wasmSafeZoneAdjustment(
        squashTypesArray[i],
        rawInputsArray[i],
        provisionalError,
        weightsArray[i],
      );
    }
  });

  // Batch: 1 WASM call for all synapses
  Deno.bench({
    name: `Batch (1 call, ${SYNAPSE_COUNT} synapses)`,
    group: groupName,
  }, () => {
    wasmSafeZoneAdjustmentBatch(
      squashTypesArray,
      rawInputsArray,
      provisionalError,
      weightsArray,
    );
  });
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1376: Batch vs Scalar safe zone adjustment");
console.log("=".repeat(70));
console.log(
  "Comparing WASM boundary crossing overhead between scalar and batch approaches.",
);
console.log("Lower is better for each group.\n");
