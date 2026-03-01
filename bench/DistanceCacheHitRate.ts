/**
 * Benchmark for distance cache hit rate analysis during speciation.
 *
 * Issue #1633: Investigate whether migrating genetic compatibility scoring
 * to Rust/WASM would improve performance. This benchmark simulates the
 * O(n²) pairwise compatibility checks that occur during speciation and
 * measures the distance cache hit rate.
 *
 * If the cache hit rate is high, the current TypeScript + caching strategy
 * is already effective and WASM migration would yield minimal benefit.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/DistanceCacheHitRate.ts
 */
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { geneticCompatibility } from "../src/breed/GeneticCompatibility.ts";
import {
  clearDistanceCache,
  getDistanceCacheStats,
} from "../src/breed/DistanceCache.ts";

/**
 * Creates a creature with a specified number of hidden neurons and
 * controlled overlap with a "base" set of shared neuron UUIDs.
 */
function createCreatureForSpeciation(
  hiddenNeuronCount: number,
  sharedCount: number,
  uniquePrefix: string,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Add shared hidden neurons
  for (let i = 0; i < sharedCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `shared-hidden-${i}`,
      squash: "TANH",
      bias: 0.1,
    });
  }

  // Add unique hidden neurons
  const uniqueCount = hiddenNeuronCount - sharedCount;
  for (let i = 0; i < uniqueCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${uniquePrefix}-unique-${i}`,
      squash: "TANH",
      bias: 0.1,
    });
  }

  // Add output neuron
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  // Connect inputs to first hidden neuron
  for (let i = 0; i < 5; i++) {
    const firstNeuronUUID = sharedCount > 0
      ? `shared-hidden-0`
      : `${uniquePrefix}-unique-0`;
    synapses.push({
      fromUUID: `input-${i}`,
      toUUID: firstNeuronUUID,
      weight: 0.5,
    });
  }

  // Chain all hidden neurons
  const allUUIDs: string[] = [];
  for (let i = 0; i < sharedCount; i++) {
    allUUIDs.push(`shared-hidden-${i}`);
  }
  for (let i = 0; i < uniqueCount; i++) {
    allUUIDs.push(`${uniquePrefix}-unique-${i}`);
  }

  for (let i = 0; i < allUUIDs.length - 1; i++) {
    synapses.push({
      fromUUID: allUUIDs[i],
      toUUID: allUUIDs[i + 1],
      weight: 0.5,
    });
  }

  // Connect last hidden to output
  if (allUUIDs.length > 0) {
    synapses.push({
      fromUUID: allUUIDs[allUUIDs.length - 1],
      toUUID: "output-0",
      weight: 0.5,
    });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: 5,
    output: 1,
  });
  creature.validate();
  // Generate UUID so the distance cache can be exercised
  CreatureUtil.makeUUID(creature);
  return creature;
}

// === Cache Hit Rate Analysis ===
// Simulate a population of creatures for speciation
const POPULATION_SIZE = 50;
const HIDDEN_NEURONS = 100;
const SHARED_NEURONS = 60; // 60% shared structure

const population: Creature[] = [];
for (let i = 0; i < POPULATION_SIZE; i++) {
  population.push(
    createCreatureForSpeciation(
      HIDDEN_NEURONS,
      SHARED_NEURONS,
      `creature-${i}`,
    ),
  );
}

// === Round 1: Cold cache — all pairs are misses ===
clearDistanceCache();

for (let i = 0; i < population.length; i++) {
  for (let j = i + 1; j < population.length; j++) {
    geneticCompatibility(population[i], population[j]);
  }
}

const round1Stats = getDistanceCacheStats();
const totalPairs = (POPULATION_SIZE * (POPULATION_SIZE - 1)) / 2;
console.log("\n=== Round 1: Cold cache (first speciation pass) ===");
console.log(`Population size: ${POPULATION_SIZE}`);
console.log(`Total pairs checked: ${totalPairs}`);
console.log(`Cache hits: ${round1Stats.hits}`);
console.log(`Cache misses: ${round1Stats.misses}`);
console.log(`Cache size: ${round1Stats.currentSize}`);
console.log(
  `Hit rate: ${
    ((round1Stats.hits / (round1Stats.hits + round1Stats.misses)) * 100)
      .toFixed(1)
  }%`,
);

// === Round 2: Warm cache — same population, should be all hits ===
for (let i = 0; i < population.length; i++) {
  for (let j = i + 1; j < population.length; j++) {
    geneticCompatibility(population[i], population[j]);
  }
}

const round2Stats = getDistanceCacheStats();
const round2Hits = round2Stats.hits - round1Stats.hits;
const round2Misses = round2Stats.misses - round1Stats.misses;
console.log("\n=== Round 2: Warm cache (same population, next generation) ===");
console.log(`Cache hits: ${round2Hits}`);
console.log(`Cache misses: ${round2Misses}`);
console.log(
  `Hit rate: ${((round2Hits / (round2Hits + round2Misses)) * 100).toFixed(1)}%`,
);

// === Round 3: Partially refreshed population (simulate evolution) ===
// Replace 20% of the population with new creatures (offspring)
const replacementCount = Math.floor(POPULATION_SIZE * 0.2);
for (let i = 0; i < replacementCount; i++) {
  population[i] = createCreatureForSpeciation(
    HIDDEN_NEURONS,
    SHARED_NEURONS,
    `offspring-${i}`,
  );
}

const beforeRound3 = getDistanceCacheStats();

for (let i = 0; i < population.length; i++) {
  for (let j = i + 1; j < population.length; j++) {
    geneticCompatibility(population[i], population[j]);
  }
}

const round3Stats = getDistanceCacheStats();
const round3Hits = round3Stats.hits - beforeRound3.hits;
const round3Misses = round3Stats.misses - beforeRound3.misses;
console.log(
  "\n=== Round 3: 20% population replaced (simulated evolution) ===",
);
console.log(`Cache hits: ${round3Hits}`);
console.log(`Cache misses: ${round3Misses}`);
console.log(
  `Hit rate: ${((round3Hits / (round3Hits + round3Misses)) * 100).toFixed(1)}%`,
);

// === Summary ===
const overallHits = round3Stats.hits;
const overallMisses = round3Stats.misses;
console.log("\n=== Overall Summary ===");
console.log(`Total hits: ${overallHits}`);
console.log(`Total misses: ${overallMisses}`);
console.log(
  `Overall hit rate: ${
    ((overallHits / (overallHits + overallMisses)) * 100).toFixed(1)
  }%`,
);
console.log(`Evictions: ${round3Stats.evictions}`);
console.log(`Final cache size: ${round3Stats.currentSize}`);

// === Benchmark: pairwise compatibility (warm cache) ===
Deno.bench({
  name: "Pairwise compatibility (warm cache, 50 creatures)",
  fn() {
    for (let i = 0; i < population.length; i++) {
      for (let j = i + 1; j < population.length; j++) {
        geneticCompatibility(population[i], population[j]);
      }
    }
  },
});

// === Benchmark: single pair (cache hit) ===
Deno.bench({
  name: "Single geneticCompatibility call (cache hit)",
  fn() {
    geneticCompatibility(population[20], population[30]);
  },
});

// === Benchmark: single pair (cache miss, cleared cache) ===
const isolatedA = createCreatureForSpeciation(100, 60, "isolated-a");
const isolatedB = createCreatureForSpeciation(100, 60, "isolated-b");

Deno.bench({
  name: "Single geneticCompatibility call (cache miss)",
  group: "cache-impact",
  fn() {
    clearDistanceCache();
    geneticCompatibility(isolatedA, isolatedB);
  },
});

Deno.bench({
  name: "Single geneticCompatibility call (cache hit)",
  group: "cache-impact",
  baseline: true,
  fn() {
    geneticCompatibility(isolatedA, isolatedB);
  },
});
