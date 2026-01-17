/**
 * Benchmark: Single-pass de-duplication (Issue #1099)
 *
 * This benchmark measures the performance improvement from reducing de-duplication
 * frequency in the evolution loop from two passes to one.
 *
 * The optimisation:
 * - Previously: De-duplicate after breeding/mutation, then again after combining
 *   all population sources (two passes)
 * - Now: Single de-duplication pass after all population sources are combined
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/SinglePassDeDuplication.ts
 */
import { Creature } from "../src/Creature.ts";
import { Breed } from "../src/breed/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
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

console.log("=== De-duplication Benchmark Setup ===");
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
    modifiedJSON.neurons[0].bias = Math.random();
    modifiedJSON.neurons[1].bias = Math.random();
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
 * Benchmark: Two-pass de-duplication (old approach)
 *
 * This simulates the previous behaviour where de-duplication was run:
 * 1. On newPopulation after breeding/mutation
 * 2. On combined population after merging all sources
 */
Deno.bench({
  name: "Two-pass de-duplication (old)",
  group: "De-duplication frequency",
  fn() {
    // Simulate different population sources
    const elitists = createPopulationWithDuplicates(0, 5);
    const trainedPopulation = createPopulationWithDuplicates(0.1, 10);
    const fineTunedPopulation = createPopulationWithDuplicates(0.1, 5);
    const newPopulation = createPopulationWithDuplicates(0.3, 70); // Most duplication here
    const dnaPopulation = createPopulationWithDuplicates(0.2, 10);

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    // First pass: de-duplicate newPopulation only
    deDuplicator.perform(newPopulation);

    // Combine all sources
    const combined = [
      ...elitists,
      ...trainedPopulation,
      ...fineTunedPopulation,
      ...newPopulation,
      ...dnaPopulation,
    ];

    // Second pass: de-duplicate combined population
    deDuplicator.perform(combined);
  },
});

/**
 * Benchmark: Single-pass de-duplication (new approach)
 *
 * This is the optimised approach where de-duplication is run only once
 * after all population sources are combined.
 */
Deno.bench({
  name: "Single-pass de-duplication (new)",
  group: "De-duplication frequency",
  baseline: true,
  fn() {
    // Simulate different population sources
    const elitists = createPopulationWithDuplicates(0, 5);
    const trainedPopulation = createPopulationWithDuplicates(0.1, 10);
    const fineTunedPopulation = createPopulationWithDuplicates(0.1, 5);
    const newPopulation = createPopulationWithDuplicates(0.3, 70);
    const dnaPopulation = createPopulationWithDuplicates(0.2, 10);

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    // Combine all sources first
    const combined = [
      ...elitists,
      ...trainedPopulation,
      ...fineTunedPopulation,
      ...newPopulation,
      ...dnaPopulation,
    ];

    // Single de-duplication pass
    deDuplicator.perform(combined);
  },
});

/**
 * Benchmark: UUID computation overhead
 *
 * This measures the cost of computing UUIDs, which is done during
 * de-duplication. Single-pass reduces the number of times UUIDs are
 * computed for the same creatures.
 */
Deno.bench({
  name: "UUID computation (100 creatures)",
  group: "UUID overhead",
  fn() {
    const population = createPopulationWithDuplicates(0, 100);
    for (const creature of population) {
      CreatureUtil.makeUUID(creature);
    }
  },
});

/**
 * Benchmark: Large population with high duplicate rate
 *
 * This tests the worst-case scenario where there are many duplicates
 * across different population sources.
 */
Deno.bench({
  name: "Single-pass with 50% duplicates (150 creatures)",
  group: "High duplicate scenarios",
  baseline: true,
  fn() {
    const population = createPopulationWithDuplicates(0.5, 150);

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    deDuplicator.perform(population);
  },
});

/**
 * Benchmark: Two-pass with high duplicates for comparison
 */
Deno.bench({
  name: "Two-pass with 50% duplicates (150 creatures)",
  group: "High duplicate scenarios",
  fn() {
    // Split into two groups to simulate two-pass
    const firstGroup = createPopulationWithDuplicates(0.5, 100);
    const secondGroup = createPopulationWithDuplicates(0.5, 50);

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    // First pass
    deDuplicator.perform(firstGroup);

    // Combine
    const combined = [...firstGroup, ...secondGroup];

    // Second pass
    deDuplicator.perform(combined);
  },
});
