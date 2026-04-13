/**
 * Benchmark: Profile evolveDir per-generation phase timing.
 *
 * Issue #2274: Systematic benchmarks that profile individual phases of the
 * evolution loop — sorting, speciation, mutation, de-duplication, and
 * writeScores — across multiple creature sizes and population sizes.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env bench/ProfileEvolveDirPhases.ts
 */
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { sortCreaturesByScore } from "@architecture/ElitismUtils.ts";
import { Breed } from "@breed/Breed.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Genus } from "@neat/Genus.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";

// --- Helper: create a population of scored creatures ---

function createPopulation(
  base: Creature,
  size: number,
): Creature[] {
  const config = createNeatConfig({
    populationSize: size,
    mutation: Mutation.FFW,
  });
  const mutator = new Mutator(config);
  const population: Creature[] = [];

  for (let i = 0; i < size; i++) {
    const clone = base.shallowClone();
    // Mutate to create diversity
    mutator.mutate([clone]);
    clone.score = -Math.random();
    CreatureUtil.makeUUID(clone);
    population.push(clone);
  }
  return population;
}

// --- Create base creatures of varying sizes ---

const smallCreature = new Creature(10, 5, {
  layers: [{ count: 35 }],
});
creatureValidate(smallCreature);

const mediumCreature = new Creature(30, 10, {
  layers: [{ count: 80 }, { count: 80 }],
});
creatureValidate(mediumCreature);

const largeCreature = new Creature(50, 20, {
  layers: [{ count: 150 }, { count: 150 }],
});
creatureValidate(largeCreature);

console.log("=== Creature Sizes ===");
console.log(
  `Small:  ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `Medium: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large:  ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

// --- Pre-create populations for benchmarks ---

const SMALL_POP = 50;
const LARGE_POP = 150;

const smallPop50 = createPopulation(smallCreature, SMALL_POP);
const smallPop150 = createPopulation(smallCreature, LARGE_POP);
const mediumPop50 = createPopulation(mediumCreature, SMALL_POP);
const mediumPop150 = createPopulation(mediumCreature, LARGE_POP);
const largePop50 = createPopulation(largeCreature, SMALL_POP);
const largePop150 = createPopulation(largeCreature, LARGE_POP);

// ============================================================
// Sort benchmarks
// ============================================================

function benchSort(population: Creature[]): void {
  const pop = population.map((c) => {
    const clone = c.shallowClone();
    clone.score = c.score;
    return clone;
  });
  sortCreaturesByScore(pop);
}

Deno.bench({
  name: "Sort: Small creature, pop=50",
  group: "Sort by score",
  baseline: true,
  fn() {
    benchSort(smallPop50);
  },
});

Deno.bench({
  name: "Sort: Small creature, pop=150",
  group: "Sort by score",
  fn() {
    benchSort(smallPop150);
  },
});

Deno.bench({
  name: "Sort: Medium creature, pop=50",
  group: "Sort by score",
  fn() {
    benchSort(mediumPop50);
  },
});

Deno.bench({
  name: "Sort: Medium creature, pop=150",
  group: "Sort by score",
  fn() {
    benchSort(mediumPop150);
  },
});

Deno.bench({
  name: "Sort: Large creature, pop=50",
  group: "Sort by score",
  fn() {
    benchSort(largePop50);
  },
});

Deno.bench({
  name: "Sort: Large creature, pop=150",
  group: "Sort by score",
  fn() {
    benchSort(largePop150);
  },
});

// ============================================================
// Speciation (Genus) benchmarks
// ============================================================

function benchSpeciation(population: Creature[]): void {
  const genus = new Genus();
  for (const creature of population) {
    CreatureUtil.makeUUID(creature);
    genus.addCreature(creature);
  }
}

Deno.bench({
  name: "Speciation: Small creature, pop=50",
  group: "Speciation (Genus)",
  baseline: true,
  fn() {
    benchSpeciation(smallPop50);
  },
});

Deno.bench({
  name: "Speciation: Small creature, pop=150",
  group: "Speciation (Genus)",
  fn() {
    benchSpeciation(smallPop150);
  },
});

Deno.bench({
  name: "Speciation: Medium creature, pop=50",
  group: "Speciation (Genus)",
  fn() {
    benchSpeciation(mediumPop50);
  },
});

Deno.bench({
  name: "Speciation: Medium creature, pop=150",
  group: "Speciation (Genus)",
  fn() {
    benchSpeciation(mediumPop150);
  },
});

Deno.bench({
  name: "Speciation: Large creature, pop=50",
  group: "Speciation (Genus)",
  fn() {
    benchSpeciation(largePop50);
  },
});

Deno.bench({
  name: "Speciation: Large creature, pop=150",
  group: "Speciation (Genus)",
  fn() {
    benchSpeciation(largePop150);
  },
});

// ============================================================
// Mutation benchmarks
// ============================================================

function benchMutation(base: Creature, size: number): void {
  const config = createNeatConfig({
    populationSize: size,
    mutation: Mutation.FFW,
  });
  const mutator = new Mutator(config);
  const population = [];
  for (let i = 0; i < size; i++) {
    const clone = base.shallowClone();
    delete clone.score;
    delete clone.uuid;
    population.push(clone);
  }
  mutator.mutate(population);
}

Deno.bench({
  name: "Mutation: Small creature, pop=50",
  group: "Mutation",
  baseline: true,
  fn() {
    benchMutation(smallCreature, SMALL_POP);
  },
});

Deno.bench({
  name: "Mutation: Small creature, pop=150",
  group: "Mutation",
  fn() {
    benchMutation(smallCreature, LARGE_POP);
  },
});

Deno.bench({
  name: "Mutation: Medium creature, pop=50",
  group: "Mutation",
  fn() {
    benchMutation(mediumCreature, SMALL_POP);
  },
});

Deno.bench({
  name: "Mutation: Medium creature, pop=150",
  group: "Mutation",
  fn() {
    benchMutation(mediumCreature, LARGE_POP);
  },
});

Deno.bench({
  name: "Mutation: Large creature, pop=50",
  group: "Mutation",
  fn() {
    benchMutation(largeCreature, SMALL_POP);
  },
});

Deno.bench({
  name: "Mutation: Large creature, pop=150",
  group: "Mutation",
  fn() {
    benchMutation(largeCreature, LARGE_POP);
  },
});

// ============================================================
// De-duplication benchmarks
// ============================================================

async function benchDeDuplication(base: Creature, size: number): Promise<void> {
  const config = createNeatConfig({
    populationSize: size,
    mutation: Mutation.FFW,
  });
  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  // Create population with some deliberate duplicates
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const clone = base.shallowClone();
    // Only mutate most creatures - leave ~10% as duplicates
    if (i % 10 !== 0 || i === 0) {
      mutator.mutate([clone]);
    }
    clone.score = -Math.random();
    CreatureUtil.makeUUID(clone);
    population.push(clone);
  }

  // Seed the genus with initial creatures for breeding
  for (const creature of population.slice(0, Math.min(5, population.length))) {
    genus.addCreature(creature);
  }

  await deDuplicator.perform(population);
}

Deno.bench({
  name: "DeDuplication: Small creature, pop=50",
  group: "De-duplication",
  baseline: true,
  async fn() {
    await benchDeDuplication(smallCreature, SMALL_POP);
  },
});

Deno.bench({
  name: "DeDuplication: Small creature, pop=150",
  group: "De-duplication",
  async fn() {
    await benchDeDuplication(smallCreature, LARGE_POP);
  },
});

Deno.bench({
  name: "DeDuplication: Medium creature, pop=50",
  group: "De-duplication",
  async fn() {
    await benchDeDuplication(mediumCreature, SMALL_POP);
  },
});

Deno.bench({
  name: "DeDuplication: Medium creature, pop=150",
  group: "De-duplication",
  async fn() {
    await benchDeDuplication(mediumCreature, LARGE_POP);
  },
});

Deno.bench({
  name: "DeDuplication: Large creature, pop=50",
  group: "De-duplication",
  async fn() {
    await benchDeDuplication(largeCreature, SMALL_POP);
  },
});

Deno.bench({
  name: "DeDuplication: Large creature, pop=150",
  group: "De-duplication",
  async fn() {
    await benchDeDuplication(largeCreature, LARGE_POP);
  },
});
