/**
 * Pre-Fitness Memory Eviction Benchmark
 *
 * Issue #2263 - Benchmark: memory pressure and WASM cache behaviour during
 * fitness evaluation.
 *
 * Measures the impact of proactive pre-fitness memory eviction vs reactive
 * per-creature eviction when WASM caches are under pressure.
 *
 * Hypothesis: Proactive bulk eviction before the fitness phase reduces
 * scattered per-creature eviction attempts inside CreatureActivation.ts,
 * lowering total activation time under memory pressure.
 *
 * Run with:
 *   deno bench --allow-all bench/PreFitnessMemoryEviction.ts
 */

import { Creature } from "@creature";
import {
  clearWasmCompilationCache,
  getWasmCompilationCacheStats,
  initWasmActivation,
  isWasmActivationAvailable,
  setWasmCompilationCacheSize,
} from "@wasm/mod.ts";
import { setMaxCachedWasmCreatureActivations } from "@wasm/WasmCreatureActivationLRU.ts";
import { checkMemoryAndEvict } from "@neat/MemoryMonitor.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import type { Logger } from "@utils/Logger.ts";

/** Silent logger for benchmark runs. */
const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Simple seeded random number generator. */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** Clone a creature with randomised weights (preserves topology). */
function cloneWithDifferentWeights(
  creature: Creature,
  seed: number,
): Creature {
  const rng = createSeededRandom(seed);
  const json = creature.exportJSON();
  for (const synapse of json.synapses) {
    synapse.weight = rng() * 2 - 1;
  }
  for (const neuron of json.neurons) {
    if (neuron.bias !== undefined) {
      neuron.bias = rng() * 2 - 1;
    }
  }
  return Creature.fromJSON(json);
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
const POPULATION_SIZE = 100;
const NUM_INPUTS = 10;
const NUM_HIDDEN = 15;
const NUM_OUTPUTS = 3;
// Use a small cache to simulate pressure without needing actual heap exhaustion
const CONSTRAINED_COMPILATION_CACHE = 5;
const CONSTRAINED_ACTIVATION_CACHE = 20;

// Create diverse topologies to stress the compilation cache
const topologyBases: Creature[] = [];
for (let i = 0; i < 15; i++) {
  const hidden = NUM_HIDDEN + i;
  const base = new Creature(NUM_INPUTS, NUM_OUTPUTS, {
    layers: [{ count: hidden, squash: "TANH" }],
  });
  base.fix();
  topologyBases.push(base);
}

// Create population with diverse topologies
const population: Creature[] = [];
for (let i = 0; i < POPULATION_SIZE; i++) {
  const base = topologyBases[i % topologyBases.length];
  population.push(cloneWithDifferentWeights(base, i));
}

// Generate random inputs
const inputs: Float32Array[] = [];
for (let i = 0; i < 50; i++) {
  const data = new Float32Array(NUM_INPUTS);
  for (let j = 0; j < NUM_INPUTS; j++) {
    data[j] = Math.random() * 4 - 2;
  }
  inputs.push(data);
}

console.log(`\nBenchmark: Pre-Fitness Memory Eviction (Issue #2263)`);
console.log(`  Population: ${POPULATION_SIZE} creatures`);
console.log(`  Topologies: ${topologyBases.length} unique`);
console.log(
  `  Constrained compilation cache: ${CONSTRAINED_COMPILATION_CACHE}`,
);
console.log(`  Constrained activation cache: ${CONSTRAINED_ACTIVATION_CACHE}`);

/**
 * Simulate fitness evaluation: activate every creature against all inputs.
 * This mimics what happens during neat.fitness.calculate().
 */
function simulateFitnessEvaluation(pop: Creature[]): void {
  for (let i = 0; i < pop.length; i++) {
    const creature = pop[i];
    const input = inputs[i % inputs.length];
    creature.activate(input, false);
  }
}

// Baseline: No proactive eviction — reactive eviction only
Deno.bench(
  "Fitness eval - reactive eviction only (baseline)",
  { group: "memory-pressure", baseline: true },
  () => {
    // Set constrained caches
    setWasmCompilationCacheSize(CONSTRAINED_COMPILATION_CACHE);
    setMaxCachedWasmCreatureActivations(CONSTRAINED_ACTIVATION_CACHE);

    // Dispose all cached activations to start fresh
    for (const creature of population) {
      creature.disposeWasm();
    }
    clearWasmCompilationCache();

    // Evaluate without pre-fitness eviction (the old behaviour)
    simulateFitnessEvaluation(population);
  },
);

// With proactive eviction: check memory and evict before fitness
Deno.bench(
  "Fitness eval - proactive pre-fitness eviction",
  { group: "memory-pressure" },
  () => {
    // Set constrained caches
    setWasmCompilationCacheSize(CONSTRAINED_COMPILATION_CACHE);
    setMaxCachedWasmCreatureActivations(CONSTRAINED_ACTIVATION_CACHE);

    // Dispose all cached activations to start fresh
    for (const creature of population) {
      creature.disposeWasm();
    }
    clearWasmCompilationCache();

    // Proactive eviction before fitness (the new behaviour)
    checkMemoryAndEvict(DEFAULT_MEMORY_CONFIG, silentLogger);

    simulateFitnessEvaluation(population);
  },
);

// Sustained pressure: multiple "generations" with constrained cache
Deno.bench(
  "Multi-gen sustained pressure - reactive only (baseline)",
  { group: "sustained-pressure", baseline: true },
  () => {
    setWasmCompilationCacheSize(CONSTRAINED_COMPILATION_CACHE);
    setMaxCachedWasmCreatureActivations(CONSTRAINED_ACTIVATION_CACHE);
    clearWasmCompilationCache();

    // Simulate 3 generations without pre-fitness eviction
    for (let gen = 0; gen < 3; gen++) {
      simulateFitnessEvaluation(population);
    }
  },
);

Deno.bench(
  "Multi-gen sustained pressure - proactive eviction",
  { group: "sustained-pressure" },
  () => {
    setWasmCompilationCacheSize(CONSTRAINED_COMPILATION_CACHE);
    setMaxCachedWasmCreatureActivations(CONSTRAINED_ACTIVATION_CACHE);
    clearWasmCompilationCache();

    // Simulate 3 generations WITH pre-fitness eviction each generation
    for (let gen = 0; gen < 3; gen++) {
      checkMemoryAndEvict(DEFAULT_MEMORY_CONFIG, silentLogger);
      simulateFitnessEvaluation(population);
    }
  },
);

// Cache statistics comparison
Deno.bench(
  "Cache stats - constrained cache churn",
  { group: "cache-stats" },
  () => {
    setWasmCompilationCacheSize(CONSTRAINED_COMPILATION_CACHE);
    setMaxCachedWasmCreatureActivations(CONSTRAINED_ACTIVATION_CACHE);
    clearWasmCompilationCache();

    for (const creature of population) {
      creature.disposeWasm();
    }

    simulateFitnessEvaluation(population);

    const stats = getWasmCompilationCacheStats();
    console.log(`\n  Constrained cache stats:`);
    console.log(`    Hits: ${stats.hits}, Misses: ${stats.misses}`);
    console.log(
      `    Hit rate: ${
        (stats.hits / Math.max(1, stats.hits + stats.misses) * 100).toFixed(1)
      }%`,
    );
    console.log(`    Evictions: ${stats.evictions}`);
  },
);

Deno.bench(
  "Cache stats - adequate cache",
  { group: "cache-stats" },
  () => {
    setWasmCompilationCacheSize(100);
    setMaxCachedWasmCreatureActivations(512);
    clearWasmCompilationCache();

    for (const creature of population) {
      creature.disposeWasm();
    }

    simulateFitnessEvaluation(population);

    const stats = getWasmCompilationCacheStats();
    console.log(`\n  Adequate cache stats:`);
    console.log(`    Hits: ${stats.hits}, Misses: ${stats.misses}`);
    console.log(
      `    Hit rate: ${
        (stats.hits / Math.max(1, stats.hits + stats.misses) * 100).toFixed(1)
      }%`,
    );
    console.log(`    Evictions: ${stats.evictions}`);
  },
);
