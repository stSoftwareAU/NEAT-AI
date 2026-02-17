/**
 * Issue #1519 - Benchmark: Standalone elastic error distribution (TS vs WASM)
 *
 * Compares the performance of:
 * 1. TypeScript `distributeElasticError` (current approach)
 * 2. WASM `distribute_elastic_error` (Rust with SIMD acceleration)
 *
 * Tests at different synapse counts (10, 50, 200, 1000) to demonstrate
 * scaling behaviour with high connectivity.
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/ElasticDistribution.ts
 */

import {
  initWasmActivation,
  isWasmActivationAvailable,
} from "../src/wasm/mod.ts";
import { distributeElasticError } from "../src/propagate/ElasticDistribution.ts";
import { wasmDistributeElasticError } from "../src/wasm/WasmStandaloneFunctions.ts";

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

// ============================================================================
// Benchmark at different synapse counts to show scaling behaviour
// ============================================================================
for (const SYNAPSE_COUNT of [10, 50, 200, 1000]) {
  // Pre-generate test data
  const activations = new Float32Array(SYNAPSE_COUNT);
  const safeZoneFactors = new Float32Array(SYNAPSE_COUNT);
  const weights = new Float32Array(SYNAPSE_COUNT);

  const linkMeta = new Array(SYNAPSE_COUNT);

  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    activations[i] = random();
    safeZoneFactors[i] = (random() + 1) / 2; // 0 to 1
    weights[i] = random() * 2;

    linkMeta[i] = {
      activation: activations[i],
      safeZoneFactor: safeZoneFactors[i],
      weight: weights[i],
    };
  }

  const error = 1.5;
  const groupName = `elastic-${SYNAPSE_COUNT}-synapses`;

  // TypeScript baseline
  Deno.bench({
    name: `TS distributeElasticError (${SYNAPSE_COUNT} synapses)`,
    group: groupName,
    baseline: true,
  }, () => {
    distributeElasticError(error, linkMeta);
  });

  // WASM version
  Deno.bench({
    name: `WASM distribute_elastic_error (${SYNAPSE_COUNT} synapses)`,
    group: groupName,
  }, () => {
    wasmDistributeElasticError(
      error,
      activations,
      safeZoneFactors,
      weights,
      1e-12,
    );
  });
}

// ============================================================================
// Benchmark weight-based fallback path (all activations zero)
// ============================================================================
for (const SYNAPSE_COUNT of [50, 200]) {
  const activations = new Float32Array(SYNAPSE_COUNT); // all zeros
  const safeZoneFactors = new Float32Array(SYNAPSE_COUNT).fill(1);
  const weights = new Float32Array(SYNAPSE_COUNT);

  const linkMeta = new Array(SYNAPSE_COUNT);

  for (let i = 0; i < SYNAPSE_COUNT; i++) {
    weights[i] = random() * 2;
    linkMeta[i] = {
      activation: 0,
      safeZoneFactor: 1,
      weight: weights[i],
    };
  }

  const error = 5.0;
  const groupName = `elastic-weight-fallback-${SYNAPSE_COUNT}`;

  Deno.bench({
    name: `TS weight fallback (${SYNAPSE_COUNT} synapses)`,
    group: groupName,
    baseline: true,
  }, () => {
    distributeElasticError(error, linkMeta);
  });

  Deno.bench({
    name: `WASM weight fallback (${SYNAPSE_COUNT} synapses)`,
    group: groupName,
  }, () => {
    wasmDistributeElasticError(
      error,
      activations,
      safeZoneFactors,
      weights,
      1e-12,
    );
  });
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1519: Elastic error distribution (TS vs WASM)");
console.log("=".repeat(70));
console.log(
  "Comparing TypeScript distributeElasticError vs WASM distribute_elastic_error.",
);
console.log("Lower is better for each group.\n");
