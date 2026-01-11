/**
 * Benchmark for ParallelBreeding performance optimisation.
 *
 * Issue #1026: Parallelise breeding loop using worker pool.
 *
 * This benchmark compares:
 * 1. Sequential breeding: Original approach using Breed.breed() in a loop
 * 2. Parallel breeding (no workers): Using ParallelBreeding without workers
 * 3. Parallel breeding (with workers): Using ParallelBreeding with worker pool
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/ParallelBreeding.ts
 */
import { Creature } from "../src/Creature.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { Breed } from "../src/breed/Breed.ts";
import { ParallelBreeding } from "../src/breed/ParallelBreeding.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";
import type { CreatureExport } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";

/**
 * Creates a test creature with specified parameters.
 */
function createTestCreature(
  inputCount: number,
  outputCount: number,
  hiddenCount: number,
  prefix: string,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Add hidden neurons
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-hidden-${i}`,
      squash: i % 3 === 0 ? "TANH" : i % 3 === 1 ? "IDENTITY" : "LeakyReLU",
      bias: 0.1 * (i % 10),
    });
  }

  // Add output neurons
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  // Connect inputs to hidden neurons
  for (let i = 0; i < inputCount; i++) {
    for (let j = 0; j < Math.min(hiddenCount, 5); j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `${prefix}-hidden-${j}`,
        weight: 0.5 * ((i + j) % 10) / 10,
      });
    }
  }

  // Chain hidden neurons
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-hidden-${i}`,
      toUUID: `${prefix}-hidden-${i + 1}`,
      weight: 0.5,
    });
  }

  // Connect last hidden neurons to outputs
  if (hiddenCount > 0) {
    for (let j = 0; j < outputCount; j++) {
      synapses.push({
        fromUUID: `${prefix}-hidden-${hiddenCount - 1}`,
        toUUID: `output-${j}`,
        weight: 0.5,
      });
    }
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: inputCount,
    output: outputCount,
  });

  creature.validate();
  return creature;
}

/**
 * Creates a population of diverse creatures for benchmarking.
 */
function createBenchmarkPopulation(
  size: number,
  inputCount: number,
  outputCount: number,
): Genus {
  const genus = new Genus();

  for (let i = 0; i < size; i++) {
    const hiddenCount = 10 + (i % 20); // 10-29 hidden neurons
    const creature = createTestCreature(
      inputCount,
      outputCount,
      hiddenCount,
      `creature-${i}`,
    );

    // Assign score for parent selection
    creature.score = -0.5 + (i / size) * 0.3; // Scores from -0.5 to -0.2

    CreatureUtil.makeUUID(creature);
    genus.addCreature(creature);
  }

  return genus;
}

// Create population for benchmarking
const mediumGenus = createBenchmarkPopulation(50, 10, 3);

const configMedium = createNeatConfig({
  populationSize: 50,
  geneticCompatibilityThreshold: 0.3,
});

console.log(`Population size: ${mediumGenus.population.length}`);
console.log(`Available CPU cores: ${navigator.hardwareConcurrency}`);

// Benchmarks without workers (main thread)
Deno.bench({
  name: "Sequential (Breed.breed loop)",
  group: "50 pop, 40 offspring",
  baseline: true,
  fn() {
    const breed = new Breed(mediumGenus, configMedium);
    for (let i = 0; i < 40; i++) {
      breed.breed();
    }
  },
});

Deno.bench({
  name: "Parallel (no workers, main thread)",
  group: "50 pop, 40 offspring",
  async fn() {
    const parallelBreeding = new ParallelBreeding(mediumGenus, configMedium);
    await parallelBreeding.breedBatch(40);
  },
});

// High-volume benchmark
Deno.bench({
  name: "Sequential (100 offspring)",
  group: "50 pop, 100 offspring",
  baseline: true,
  fn() {
    const breed = new Breed(mediumGenus, configMedium);
    for (let i = 0; i < 100; i++) {
      breed.breed();
    }
  },
});

Deno.bench({
  name: "Parallel (no workers, 100 offspring)",
  group: "50 pop, 100 offspring",
  async fn() {
    const parallelBreeding = new ParallelBreeding(mediumGenus, configMedium);
    await parallelBreeding.breedBatch(100);
  },
});
