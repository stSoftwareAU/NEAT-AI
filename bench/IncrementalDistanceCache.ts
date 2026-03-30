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
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  clearDistanceCache,
  getDistanceCacheStats,
} from "@breed/DistanceCache.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";

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

  // Use prefix hash to create non-overlapping ID ranges
  const prefixHash = Array.from(prefix).reduce(
    (acc, c) => acc + c.charCodeAt(0),
    0,
  );
  const idBase = prefixHash * 1000;

  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      id: idBase + i,
      squash: "TANH",
      bias: 0.1,
    });
  }

  neurons.push({
    type: "output",
    id: -1,
    squash: "IDENTITY",
    bias: 0,
  });

  // Connect inputs to first few hidden neurons
  const firstLayerSize = Math.min(hiddenCount, inputCount);
  for (let i = 0; i < inputCount; i++) {
    for (let j = 0; j < firstLayerSize; j++) {
      synapses.push({
        fromId: i,
        toId: idBase + j,
        weight: 0.5,
      });
    }
  }

  // Chain hidden neurons
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      fromId: idBase + i,
      toId: idBase + i + 1,
      weight: 0.5,
    });
  }

  // Last hidden to output
  if (hiddenCount > 0) {
    synapses.push({
      fromId: idBase + hiddenCount - 1,
      toId: -1,
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

    // Shared neurons (same IDs across creatures)
    for (let i = 0; i < sharedCount; i++) {
      neurons.push({
        type: "hidden",
        id: 5000 + i,
        squash: "TANH",
        bias: 0.1,
      });
    }

    // Unique neurons
    const uniqueCount = hiddenCount - sharedCount;
    for (let i = 0; i < uniqueCount; i++) {
      neurons.push({
        type: "hidden",
        id: 10000 + p * 1000 + i,
        squash: "TANH",
        bias: 0.1,
      });
    }

    neurons.push({
      type: "output",
      id: -1,
      squash: "IDENTITY",
      bias: 0,
    });

    // Connect inputs
    const inputCount = 5;
    for (let i = 0; i < inputCount; i++) {
      synapses.push({
        fromId: i,
        toId: neurons[0].id!,
        weight: 0.5,
      });
    }

    // Chain neurons
    for (let i = 0; i < hiddenCount - 1; i++) {
      synapses.push({
        fromId: neurons[i].id!,
        toId: neurons[i + 1].id!,
        weight: 0.5,
      });
    }

    // Last to output
    synapses.push({
      fromId: neurons[hiddenCount - 1].id!,
      toId: -1,
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
  creature.getHiddenNeuronIds();
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
  `After warm-up: cache size=${warmStats.currentSize}, hits=${warmStats.hits}, misses=${warmStats.misses}`,
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
creatureA.getHiddenNeuronIds();
creatureB.getHiddenNeuronIds();

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
