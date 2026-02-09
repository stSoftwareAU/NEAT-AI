/**
 * Benchmark for incremental species distance caching.
 *
 * Issue #1293: Measures the benefit of caching pairwise genetic compatibility
 * distances between creatures that remain unchanged across generations.
 *
 * The distance cache stores computed compatibility scores keyed by creature UUID
 * pairs. Since creature UUIDs are deterministic hashes of structure, a cached
 * distance remains valid as long as neither creature has been structurally
 * modified.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/IncrementalDistanceCache.ts
 */
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import {
  clearDistanceCache,
  getDistanceCacheStats,
} from "../src/breed/DistanceCache.ts";
import { geneticCompatibility } from "../src/breed/GeneticCompatibility.ts";

/**
 * Creates a creature with a specified number of hidden neurons.
 */
function createCreature(
  hiddenCount: number,
  prefix: string,
  inputCount = 5,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-h-${i}`,
      squash: "TANH",
      bias: 0.1,
    });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  // Connect inputs to first few hidden neurons
  const firstLayerSize = Math.min(hiddenCount, inputCount);
  for (let i = 0; i < inputCount; i++) {
    for (let j = 0; j < firstLayerSize; j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `${prefix}-h-${j}`,
        weight: 0.5,
      });
    }
  }

  // Chain hidden neurons
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-h-${i}`,
      toUUID: `${prefix}-h-${i + 1}`,
      weight: 0.5,
    });
  }

  // Last hidden to output
  if (hiddenCount > 0) {
    synapses.push({
      fromUUID: `${prefix}-h-${hiddenCount - 1}`,
      toUUID: "output-0",
      weight: 0.5,
    });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: inputCount,
    output: 1,
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Creates a population of creatures with partial overlap.
 */
function createPopulation(
  size: number,
  hiddenCount: number,
  overlapFraction: number,
): Creature[] {
  const population: Creature[] = [];
  const sharedCount = Math.floor(hiddenCount * overlapFraction);

  for (let p = 0; p < size; p++) {
    const neurons: CreatureExport["neurons"] = [];
    const synapses: CreatureExport["synapses"] = [];

    // Shared neurons (same UUIDs across creatures)
    for (let i = 0; i < sharedCount; i++) {
      neurons.push({
        type: "hidden",
        uuid: `shared-h-${i}`,
        squash: "TANH",
        bias: 0.1,
      });
    }

    // Unique neurons
    const uniqueCount = hiddenCount - sharedCount;
    for (let i = 0; i < uniqueCount; i++) {
      neurons.push({
        type: "hidden",
        uuid: `c${p}-h-${i}`,
        squash: "TANH",
        bias: 0.1,
      });
    }

    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    });

    // Connect inputs
    const inputCount = 5;
    for (let i = 0; i < inputCount; i++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: neurons[0].uuid!,
        weight: 0.5,
      });
    }

    // Chain neurons
    for (let i = 0; i < hiddenCount - 1; i++) {
      synapses.push({
        fromUUID: neurons[i].uuid!,
        toUUID: neurons[i + 1].uuid!,
        weight: 0.5,
      });
    }

    // Last to output
    synapses.push({
      fromUUID: neurons[hiddenCount - 1].uuid!,
      toUUID: "output-0",
      weight: 0.5,
    });

    const creature = Creature.fromJSON({
      neurons,
      synapses,
      input: inputCount,
      output: 1,
    });
    creature.validate();
    CreatureUtil.makeUUID(creature);
    population.push(creature);
  }

  return population;
}

// --- Setup ---

const populationSize = 50;
const hiddenNeuronCount = 100;
const population = createPopulation(populationSize, hiddenNeuronCount, 0.5);

// Pre-warm hidden neuron UUID caches
for (const creature of population) {
  creature.getHiddenNeuronUUIDs();
}

console.log(
  `Population: ${populationSize} creatures, ${hiddenNeuronCount} hidden neurons each, 50% shared`,
);
const pairCount = (populationSize * (populationSize - 1)) / 2;
console.log(`Pairwise comparisons per pass: ${pairCount}`);

// --- Benchmark: First pass (cold cache - all misses) ---

Deno.bench({
  name: "Cold cache: all pairwise distances (first computation)",
  fn() {
    clearDistanceCache();
    for (let i = 0; i < population.length; i++) {
      for (let j = i + 1; j < population.length; j++) {
        geneticCompatibility(population[i], population[j]);
      }
    }
  },
});

// --- Benchmark: Warm cache (all hits) ---

// Pre-populate cache
clearDistanceCache();
for (let i = 0; i < population.length; i++) {
  for (let j = i + 1; j < population.length; j++) {
    geneticCompatibility(population[i], population[j]);
  }
}

const warmStats = getDistanceCacheStats();
console.log(
  `After warm-up: cache size=${warmStats.size}, hits=${warmStats.hits}, misses=${warmStats.misses}`,
);

Deno.bench({
  name: "Warm cache: all pairwise distances (cache hits)",
  fn() {
    for (let i = 0; i < population.length; i++) {
      for (let j = i + 1; j < population.length; j++) {
        geneticCompatibility(population[i], population[j]);
      }
    }
  },
});

// --- Benchmark: Simulated multi-generation (cache benefits compound) ---

Deno.bench({
  name: "Warm cache: repeated pairwise distances (3 generations)",
  fn() {
    for (let gen = 0; gen < 3; gen++) {
      for (let i = 0; i < population.length; i++) {
        for (let j = i + 1; j < population.length; j++) {
          geneticCompatibility(population[i], population[j]);
        }
      }
    }
  },
});

// --- Benchmark: Single creature pair repeated ---

const creatureA = createCreature(200, "bench-a");
const creatureB = createCreature(200, "bench-b");
creatureA.getHiddenNeuronUUIDs();
creatureB.getHiddenNeuronUUIDs();

// Pre-populate cache for the pair
geneticCompatibility(creatureA, creatureB);

Deno.bench({
  name: "Warm cache: single pair repeated 100 times",
  fn() {
    for (let i = 0; i < 100; i++) {
      geneticCompatibility(creatureA, creatureB);
    }
  },
});
