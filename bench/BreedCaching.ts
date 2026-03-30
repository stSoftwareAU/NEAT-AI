/**
 * Benchmark for FitnessRanking and NeatConfig caching per generation.
 *
 * Issue #1538: Measures the cost of creating FitnessRanking and NeatConfig
 * objects per breed() call vs caching them per generation.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/BreedCaching.ts
 */
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Breed } from "../src/breed/Breed.ts";
import { ParallelBreeding } from "../src/breed/ParallelBreeding.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";
import { Selection } from "@methods/Selection.ts";
import { Genus } from "@neat/Genus.ts";

/**
 * Creates a scored test creature with a given number of hidden neurons.
 */
function createScoredCreature(
  prefix: string,
  hiddenCount: number,
  score: number,
  seed: number,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const squashOptions = ["TANH", "IDENTITY", "LeakyReLU", "LOGISTIC", "RELU"];
  let state = seed;
  const rng = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-h-${i}`,
      squash: squashOptions[Math.floor(rng() * squashOptions.length)],
      bias: (rng() - 0.5) * 2,
    });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  // Connect inputs to first hidden neurons
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < Math.min(hiddenCount, 3); j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `${prefix}-h-${j}`,
        weight: (rng() - 0.5) * 2,
      });
    }
  }

  // Chain hidden neurons
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-h-${i}`,
      toUUID: `${prefix}-h-${i + 1}`,
      weight: (rng() - 0.5) * 2,
    });
  }

  // Connect last hidden to output
  if (hiddenCount > 0) {
    synapses.push({
      fromUUID: `${prefix}-h-${hiddenCount - 1}`,
      toUUID: "output-0",
      weight: (rng() - 0.5) * 2,
    });
  }

  const creature = Creature.fromJSON({
    input: 3,
    output: 1,
    neurons,
    synapses,
  });
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  return creature;
}

function createPopulation(size: number): Genus {
  const genus = new Genus();
  for (let i = 0; i < size; i++) {
    const creature = createScoredCreature(
      `c${i}`,
      5 + (i % 8),
      -0.5 + (i / size) * 0.4,
      42 + i * 7919,
    );
    genus.addCreature(creature);
  }
  return genus;
}

// Population sizes to bench
const smallGenus = createPopulation(20);
const mediumGenus = createPopulation(50);

const config = createNeatConfig({
  selection: Selection.POWER,
  populationSize: 50,
});

// Breed.breed() — includes FitnessRanking + config creation overhead
Deno.bench({
  name: "Breed.breed() x50 (pop=20)",
  group: "Breed per-generation caching",
  baseline: true,
  fn() {
    const breed = new Breed(smallGenus, config);
    for (let i = 0; i < 50; i++) {
      breed.breed();
    }
  },
});

Deno.bench({
  name: "Breed.breed() x50 (pop=50)",
  group: "Breed per-generation caching",
  fn() {
    const breed = new Breed(mediumGenus, config);
    for (let i = 0; i < 50; i++) {
      breed.breed();
    }
  },
});

// ParallelBreeding.breedBatch() — includes FitnessRanking + config creation
Deno.bench({
  name: "ParallelBreeding.breedBatch(50) (pop=50)",
  group: "ParallelBreeding caching",
  baseline: true,
  async fn() {
    const pb = new ParallelBreeding(mediumGenus, config);
    await pb.breedBatch(50);
  },
});
