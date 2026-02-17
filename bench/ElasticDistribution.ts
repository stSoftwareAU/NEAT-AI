/**
 * Issue #1519 - Benchmark: Elastic error distribution TS vs WASM
 *
 * Compares the performance of:
 * 1. TypeScript distributeElasticError (via object-array interface)
 * 2. WASM distribute_elastic_error (via struct-of-arrays Float64Array)
 *
 * Run with:
 *   deno bench --allow-read --allow-env bench/ElasticDistribution.ts
 */

import {
  initWasmActivation,
  isWasmActivationAvailable,
  wasmDistributeElasticError,
} from "../src/wasm/mod.ts";
import {
  distributeElasticError,
  type ElasticLink,
} from "../src/propagate/ElasticDistribution.ts";

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
const PLANK_CONSTANT = 1e-12;

// ============================================================================
// Benchmark at different link counts to show scaling behaviour
// ============================================================================
for (const LINK_COUNT of [10, 50, 100, 200]) {
  const error = random() * 10;

  // Pre-generate link data for TypeScript interface
  const links: ElasticLink[] = [];
  for (let i = 0; i < LINK_COUNT; i++) {
    links.push({
      activation: random() * 3,
      safeZoneFactor: Math.abs(random()),
      weight: random() * 2,
    });
  }

  // Pre-generate struct-of-arrays for direct WASM call
  const activations = new Float64Array(LINK_COUNT);
  const safeZoneFactors = new Float64Array(LINK_COUNT);
  const weights = new Float64Array(LINK_COUNT);
  for (let i = 0; i < LINK_COUNT; i++) {
    activations[i] = links[i].activation;
    safeZoneFactors[i] = links[i].safeZoneFactor;
    weights[i] = links[i].weight ?? Number.NaN;
  }

  const groupName = `elastic-distribution-${LINK_COUNT}-links`;

  // TypeScript-only (force TS path by calling with object array)
  Deno.bench({
    name: `TS-only (${LINK_COUNT} links)`,
    group: groupName,
    baseline: true,
  }, () => {
    distributeElasticError(error, links, {
      plankConstant: PLANK_CONSTANT,
    });
  });

  // Direct WASM call (struct-of-arrays, no object conversion)
  Deno.bench({
    name: `WASM-direct (${LINK_COUNT} links)`,
    group: groupName,
  }, () => {
    wasmDistributeElasticError(
      error,
      activations,
      safeZoneFactors,
      weights,
      PLANK_CONSTANT,
    );
  });
}

console.log("\n" + "=".repeat(70));
console.log("Issue #1519: Elastic error distribution - TS vs WASM");
console.log("=".repeat(70));
console.log(
  "Comparing TypeScript distributeElasticError vs direct WASM call.",
);
console.log("Lower is better for each group.\n");
