/**
 * Benchmark: Bloom filter de-duplication (Issue #1292)
 *
 * This benchmark measures the performance improvement from using a Bloom filter
 * as a fast first-pass check for duplicate detection during de-duplication.
 *
 * The optimisation:
 * - Previously: Check Set.has() for every creature UUID
 * - Now: Check Bloom filter first; only check Set if Bloom filter says "maybe"
 *
 * This reduces the number of expensive Set lookups when most creatures are unique,
 * which is the common case in a healthy evolution process.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/BloomFilterDeDuplication.ts
 */
import { Creature } from "../src/Creature.ts";
import { Breed } from "../src/breed/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { BloomFilter } from "../src/utils/BloomFilter.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

// Create base configuration
const config = createNeatConfig({
  populationSize: 100,
  elitism: 5,
  mutationRate: 0.3,
});

// Create a moderately complex creature for testing
const baseCreatureJSON: CreatureInternal = {
  neurons: [
    { bias: 0, index: 5, type: "hidden", squash: "TANH" },
    { bias: 0.1, index: 6, type: "hidden", squash: "RELU" },
    { bias: 0.2, index: 7, type: "hidden", squash: "LOGISTIC" },
    { bias: 0.3, index: 8, type: "output", squash: "TANH" },
    { bias: 0.4, index: 9, type: "output", squash: "IDENTITY" },
  ],
  synapses: [
    { weight: 0.1, from: 0, to: 5 },
    { weight: 0.2, from: 1, to: 5 },
    { weight: 0.3, from: 2, to: 6 },
    { weight: 0.4, from: 3, to: 6 },
    { weight: 0.5, from: 4, to: 7 },
    { weight: 0.6, from: 5, to: 8 },
    { weight: 0.7, from: 6, to: 8 },
    { weight: 0.8, from: 7, to: 9 },
    { weight: 0.9, from: 5, to: 9 },
  ],
  input: 5,
  output: 2,
};

const baseCreature = Creature.fromJSON(baseCreatureJSON);
const exportedJSON = baseCreature.exportJSON();

console.log("=== Bloom Filter De-duplication Benchmark Setup ===");
console.log(`Population size: ${config.populationSize}`);
console.log(
  `Base creature: ${baseCreature.neurons.length} neurons, ${baseCreature.synapses.length} synapses`,
);

/**
 * Helper function to create a population with controlled duplicate rates.
 * This simulates the different population sources in the evolution loop.
 */
function createPopulationWithDuplicates(
  duplicateRate: number,
  populationSize: number,
): Creature[] {
  const population: Creature[] = [];

  // Add original creatures (will be duplicated)
  const numOriginals = Math.floor(populationSize * (1 - duplicateRate));
  for (let i = 0; i < numOriginals; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedJSON));
    // Modify to make unique
    modifiedJSON.neurons[0].bias = i * 0.001;
    modifiedJSON.neurons[1].bias = i * 0.002;
    population.push(Creature.fromJSON(modifiedJSON));
  }

  // Add duplicates of first few creatures
  const numDuplicates = populationSize - numOriginals;
  for (let i = 0; i < numDuplicates; i++) {
    // Clone from existing population to create duplicates
    const sourceIndex = i % Math.max(1, numOriginals);
    const clone = Creature.fromJSON(population[sourceIndex].exportJSON());
    population.push(clone);
  }

  return population;
}

/**
 * Benchmark: Bloom filter operations - add and mayContain
 *
 * This measures the raw performance of the Bloom filter operations
 * used during de-duplication.
 */
Deno.bench({
  name: "BloomFilter - add 1000 UUIDs",
  group: "Bloom filter operations",
  baseline: true,
  fn() {
    const filter = BloomFilter.create(1000, 0.01);
    for (let i = 0; i < 1000; i++) {
      filter.add(`843dc7df-f60b-47f6-823d-${i.toString().padStart(12, "0")}`);
    }
  },
});

Deno.bench({
  name: "Set - add 1000 UUIDs",
  group: "Bloom filter operations",
  fn() {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(`843dc7df-f60b-47f6-823d-${i.toString().padStart(12, "0")}`);
    }
  },
});

Deno.bench({
  name: "BloomFilter - mayContain 1000 lookups (0% hit rate)",
  group: "Bloom filter lookups",
  baseline: true,
  fn() {
    const filter = BloomFilter.create(1000, 0.01);
    // Add some items
    for (let i = 0; i < 500; i++) {
      filter.add(`added-${i}`);
    }
    // Look up different items (all misses)
    for (let i = 0; i < 1000; i++) {
      filter.mayContain(`lookup-${i}`);
    }
  },
});

Deno.bench({
  name: "Set - has 1000 lookups (0% hit rate)",
  group: "Bloom filter lookups",
  fn() {
    const set = new Set<string>();
    // Add some items
    for (let i = 0; i < 500; i++) {
      set.add(`added-${i}`);
    }
    // Look up different items (all misses)
    for (let i = 0; i < 1000; i++) {
      set.has(`lookup-${i}`);
    }
  },
});

/**
 * Benchmark: De-duplication with Bloom filter (current implementation)
 *
 * This is the new implementation using Bloom filter as a fast pre-check.
 */
Deno.bench({
  name: "DeDuplicator with Bloom filter (10% duplicates, 100 creatures)",
  group: "De-duplication with Bloom filter",
  baseline: true,
  fn() {
    const population = createPopulationWithDuplicates(0.1, 100);

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    deDuplicator.perform(population);
  },
});

Deno.bench({
  name: "DeDuplicator with Bloom filter (30% duplicates, 100 creatures)",
  group: "De-duplication with Bloom filter",
  fn() {
    const population = createPopulationWithDuplicates(0.3, 100);

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    deDuplicator.perform(population);
  },
});

/**
 * Benchmark: Large population de-duplication
 *
 * Tests performance with larger populations where Bloom filter
 * benefits should be more pronounced.
 */
Deno.bench({
  name: "DeDuplicator with Bloom filter (5% duplicates, 500 creatures)",
  group: "Large population de-duplication",
  baseline: true,
  fn() {
    const largeConfig = createNeatConfig({
      populationSize: 500,
      elitism: 10,
      mutationRate: 0.3,
    });

    const population = createPopulationWithDuplicates(0.05, 500);

    const genus = new Genus();
    const breed = new Breed(genus, largeConfig);
    const mutator = new Mutator(largeConfig);
    const deDuplicator = new DeDuplicator(breed, mutator);

    deDuplicator.perform(population);
  },
});

Deno.bench({
  name: "DeDuplicator with Bloom filter (20% duplicates, 500 creatures)",
  group: "Large population de-duplication",
  fn() {
    const largeConfig = createNeatConfig({
      populationSize: 500,
      elitism: 10,
      mutationRate: 0.3,
    });

    const population = createPopulationWithDuplicates(0.2, 500);

    const genus = new Genus();
    const breed = new Breed(genus, largeConfig);
    const mutator = new Mutator(largeConfig);
    const deDuplicator = new DeDuplicator(breed, mutator);

    deDuplicator.perform(population);
  },
});

/**
 * Benchmark: Bloom filter creation overhead
 *
 * Measures the cost of creating and clearing Bloom filters,
 * which happens once per generation.
 */
Deno.bench({
  name: "BloomFilter.create() for 100 items",
  group: "Bloom filter creation",
  fn() {
    BloomFilter.create(100, 0.01);
  },
});

Deno.bench({
  name: "BloomFilter.create() for 500 items",
  group: "Bloom filter creation",
  fn() {
    BloomFilter.create(500, 0.01);
  },
});

Deno.bench({
  name: "BloomFilter.clear() (100 item capacity)",
  group: "Bloom filter creation",
  fn() {
    const filter = BloomFilter.create(100, 0.01);
    for (let i = 0; i < 10; i++) {
      filter.clear();
    }
  },
});

/**
 * Benchmark: Bloom filter with realistic UUID patterns
 *
 * Tests performance with actual UUID-like strings as used in NEAT-AI.
 */
Deno.bench({
  name: "BloomFilter with UUID strings (100 add + check)",
  group: "UUID-based operations",
  baseline: true,
  fn() {
    const filter = BloomFilter.create(200, 0.01);
    const uuids: string[] = [];

    // Generate realistic UUIDs
    for (let i = 0; i < 100; i++) {
      const uuid = `${
        i.toString(16).padStart(8, "0")
      }-f60b-47f6-823d-2992e0a4295c`;
      uuids.push(uuid);
      filter.add(uuid);
    }

    // Check for duplicates
    for (const uuid of uuids) {
      filter.mayContain(uuid);
    }
  },
});

Deno.bench({
  name: "Set with UUID strings (100 add + check)",
  group: "UUID-based operations",
  fn() {
    const set = new Set<string>();
    const uuids: string[] = [];

    // Generate realistic UUIDs
    for (let i = 0; i < 100; i++) {
      const uuid = `${
        i.toString(16).padStart(8, "0")
      }-f60b-47f6-823d-2992e0a4295c`;
      uuids.push(uuid);
      set.add(uuid);
    }

    // Check for duplicates
    for (const uuid of uuids) {
      set.has(uuid);
    }
  },
});
