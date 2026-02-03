/**
 * WASM Compilation Cache Benchmark
 *
 * Issue #1301 - Performance: WASM creature compilation caching
 *
 * This benchmark compares:
 * 1. Direct compilation (no cache) for creatures with same topology
 * 2. Cached compilation (topology-based template reuse)
 *
 * The topology hash includes neuron UUIDs, so creatures with the same
 * topology hash are:
 * - Clones (exported/imported with different weights)
 * - Parent-offspring pairs (before structural mutation)
 *
 * Expected improvement: Faster compilation for cloned populations
 *
 * Run with:
 *   deno bench --allow-all bench/WasmCompilationCache.ts
 */

import { Creature } from "../src/Creature.ts";
import {
  clearWasmCompilationCache,
  compileCreatureToWasm,
  getOrCompileWasmModule,
  getWasmCompilationCacheStats,
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "../src/wasm/mod.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";

/**
 * Clone a creature with different weights (preserves neuron UUIDs).
 * This simulates what happens during crossover/breeding.
 */
function cloneWithDifferentWeights(
  creature: Creature,
  seed: number,
): Creature {
  const rng = createSeededRandom(seed);
  const json = creature.exportJSON();

  // Randomise weights
  for (const synapse of json.synapses) {
    synapse.weight = rng() * 2 - 1;
  }
  // Randomise biases
  for (const neuron of json.neurons) {
    if (neuron.bias !== undefined) {
      neuron.bias = rng() * 2 - 1;
    }
  }

  return Creature.fromJSON(json);
}

/**
 * Simple seeded random number generator
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// Initialise WASM
const wasmInitialised = await initWasmActivation();
if (!wasmInitialised || !isWasmActivationAvailable()) {
  console.error(
    "Failed to initialise WASM module. Ensure wasm_activation is built.",
  );
  Deno.exit(1);
}

// Configuration
const POPULATION_SIZE = 50;
const NUM_INPUTS = 10;
const NUM_HIDDEN = 20;
const NUM_OUTPUTS = 3;

// Create a base creature
const baseCreature = new Creature(NUM_INPUTS, NUM_OUTPUTS, {
  layers: [{ count: NUM_HIDDEN, squash: "TANH" }],
});
baseCreature.fix();

// Create a population of clones with SAME topology but different weights
// (simulates offspring from the same parent before structural mutation)
const sameTopologyCreatures: Creature[] = [];
for (let i = 0; i < POPULATION_SIZE; i++) {
  sameTopologyCreatures.push(cloneWithDifferentWeights(baseCreature, i));
}

// Create multiple base creatures with DIFFERENT topologies
const differentBases: Creature[] = [];
for (let i = 0; i < 10; i++) {
  const hiddenCount = NUM_HIDDEN + i;
  const base = new Creature(NUM_INPUTS, NUM_OUTPUTS, {
    layers: [{ count: hiddenCount, squash: "TANH" }],
  });
  base.fix();
  differentBases.push(base);
}

// Create population with different topologies
const differentTopologyCreatures: Creature[] = [];
for (let i = 0; i < POPULATION_SIZE; i++) {
  const base = differentBases[i % differentBases.length];
  differentTopologyCreatures.push(cloneWithDifferentWeights(base, i));
}

// Verify topology hashes are same for cloned creatures
const hash0 = CreatureUtil.getTopologyHash(sameTopologyCreatures[0]);
const hash1 = CreatureUtil.getTopologyHash(sameTopologyCreatures[1]);
console.log(`\nTopology verification:`);
console.log(`  Same topology creatures have same hash: ${hash0 === hash1}`);

// Count unique topologies in different topology population
const uniqueHashes = new Set(
  differentTopologyCreatures.map((c) => CreatureUtil.getTopologyHash(c)),
);
console.log(
  `  Different topology creatures have ${uniqueHashes.size} unique topologies`,
);

console.log(`\nBenchmark configuration:`);
console.log(`  Population size: ${POPULATION_SIZE} creatures`);
console.log(
  `  Network size: ${NUM_INPUTS} inputs, ${NUM_HIDDEN} hidden, ${NUM_OUTPUTS} outputs`,
);

// Generate random inputs
const inputs: Float32Array[] = [];
for (let i = 0; i < 100; i++) {
  const data = new Float32Array(NUM_INPUTS);
  for (let j = 0; j < NUM_INPUTS; j++) {
    data[j] = Math.random() * 4 - 2;
  }
  inputs.push(data);
}

// Direct compilation benchmark (no cache, same topology)
Deno.bench(
  "Direct compilation - same topology",
  { group: "compilation", baseline: true },
  () => {
    const activations: WasmCreatureActivation[] = [];
    for (const creature of sameTopologyCreatures) {
      const compiled = compileCreatureToWasm(creature);
      const activation = WasmCreatureActivation.create(compiled);
      if (activation) {
        activations.push(activation);
      }
    }
    // Clean up
    for (const activation of activations) {
      activation.free();
    }
  },
);

// Cached compilation benchmark (same topology - should have high hit rate)
Deno.bench(
  "Cached compilation - same topology",
  { group: "compilation" },
  () => {
    clearWasmCompilationCache();
    const activations: WasmCreatureActivation[] = [];

    for (const creature of sameTopologyCreatures) {
      // Use the global cache
      const activation = getOrCompileWasmModule(creature);
      if (activation) {
        activations.push(activation);
      }
    }

    // Clean up
    for (const activation of activations) {
      activation.free();
    }
  },
);

// Direct compilation benchmark (no cache, different topologies)
Deno.bench(
  "Direct compilation - different topologies",
  { group: "compilation-varied", baseline: true },
  () => {
    const activations: WasmCreatureActivation[] = [];
    for (const creature of differentTopologyCreatures) {
      const compiled = compileCreatureToWasm(creature);
      const activation = WasmCreatureActivation.create(compiled);
      if (activation) {
        activations.push(activation);
      }
    }
    // Clean up
    for (const activation of activations) {
      activation.free();
    }
  },
);

// Cached compilation benchmark (different topologies - lower hit rate)
Deno.bench(
  "Cached compilation - different topologies",
  { group: "compilation-varied" },
  () => {
    clearWasmCompilationCache();
    const activations: WasmCreatureActivation[] = [];

    for (const creature of differentTopologyCreatures) {
      // Use the global cache
      const activation = getOrCompileWasmModule(creature);
      if (activation) {
        activations.push(activation);
      }
    }

    // Clean up
    for (const activation of activations) {
      activation.free();
    }
  },
);

// Full activation benchmark (same topology population)
Deno.bench(
  "Full activation cycle - same topology",
  { group: "full-cycle" },
  () => {
    clearWasmCompilationCache();

    for (let i = 0; i < sameTopologyCreatures.length; i++) {
      const creature = sameTopologyCreatures[i];
      const input = inputs[i % inputs.length];

      // This uses the cache internally
      creature.disposeWasm(); // Force recompilation to test cache
      creature.activate(input, false);
    }
  },
);

// Full activation benchmark (different topologies population)
Deno.bench(
  "Full activation cycle - different topologies",
  { group: "full-cycle" },
  () => {
    clearWasmCompilationCache();

    for (let i = 0; i < differentTopologyCreatures.length; i++) {
      const creature = differentTopologyCreatures[i];
      const input = inputs[i % inputs.length];

      creature.disposeWasm(); // Force recompilation to test cache
      creature.activate(input, false);
    }
  },
);

// Print cache statistics at the end
Deno.bench("Cache statistics (same topology)", { group: "stats" }, () => {
  clearWasmCompilationCache();

  // Compile all creatures once
  for (const creature of sameTopologyCreatures) {
    creature.disposeWasm();
    creature.activate(inputs[0], false);
  }

  const stats = getWasmCompilationCacheStats();
  console.log(`\n  Cache stats (same topology):`);
  console.log(`    Hits: ${stats.hits}`);
  console.log(`    Misses: ${stats.misses}`);
  console.log(
    `    Hit rate: ${
      (stats.hits / (stats.hits + stats.misses) * 100).toFixed(1)
    }%`,
  );
});
