/**
 * Test suite for Bloom filter integration in DeDuplicator (Issue #1292).
 *
 * These tests verify that the Bloom filter integration:
 * - Correctly identifies duplicates (no false negatives)
 * - Works correctly with the existing de-duplication logic
 * - Handles edge cases like empty populations and all duplicates
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { Breed } from "../src/breed/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Neat } from "../src/NEAT/Neat.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { CreatureUtil } from "../mod.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Test that Bloom filter integration preserves correctness of de-duplication.
 * This is the fundamental guarantee: no false negatives (all duplicates must be found).
 */
Deno.test("BloomFilterDeDuplication - no false negatives", () => {
  const creature: CreatureInternal = {
    neurons: [
      { bias: 0.1, index: 2, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 2 },
      { weight: 0.3, from: 1, to: 2 },
    ],
    input: 2,
    output: 1,
  };

  const neat = new Neat(2, 1, { populationSize: 50 }, []);
  const exportedCreature = Creature.fromJSON(creature).exportJSON();

  // Create population with known duplicates
  const population: Creature[] = [];

  // Add 10 identical creatures (should all be detected as duplicates except first)
  for (let i = 0; i < 10; i++) {
    population.push(Creature.fromJSON(exportedCreature));
  }

  // Add 20 unique creatures
  for (let i = 0; i < 20; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = Math.random();
    population.push(Creature.fromJSON(modifiedJSON));
  }

  // Run de-duplication
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform(population);

  // Verify no duplicates remain
  const uuids = new Set<string>();
  for (const c of population) {
    const uuid = CreatureUtil.makeUUID(c);
    assertFalse(
      uuids.has(uuid),
      `Duplicate should have been removed: ${uuid}`,
    );
    uuids.add(uuid);
  }
});

/**
 * Test that Bloom filter handles large populations correctly.
 * With larger populations, the Bloom filter becomes more effective
 * at reducing unnecessary Set lookups.
 */
Deno.test("BloomFilterDeDuplication - large population", () => {
  const creature: CreatureInternal = {
    neurons: [
      { bias: 0, index: 3, type: "hidden", squash: "TANH" },
      { bias: 0.1, index: 4, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 3 },
      { weight: 0.3, from: 1, to: 3 },
      { weight: 0.2, from: 2, to: 3 },
      { weight: 0.4, from: 3, to: 4 },
    ],
    input: 3,
    output: 1,
  };

  const neat = new Neat(3, 1, { populationSize: 200 }, []);
  const exportedCreature = Creature.fromJSON(creature).exportJSON();

  // Create large population with mixed duplicates
  const population: Creature[] = [];
  const uniqueCreatures: Creature[] = [];

  // Add 50 unique creatures with deterministic biases to ensure uniqueness
  for (let i = 0; i < 50; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = i * 0.01; // Deterministic unique values
    modifiedJSON.neurons[1].bias = i * 0.02;
    const c = Creature.fromJSON(modifiedJSON);
    uniqueCreatures.push(c);
    population.push(c);
  }

  // Add explicit duplicates of some existing creatures
  for (let i = 0; i < 30; i++) {
    const sourceIndex = i % 50;
    const clone = Creature.fromJSON(uniqueCreatures[sourceIndex].exportJSON());
    population.push(clone);
  }

  // Add more unique creatures
  for (let i = 0; i < 120; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = 100 + i * 0.01; // Different range to ensure uniqueness
    modifiedJSON.neurons[1].bias = 100 + i * 0.02;
    population.push(Creature.fromJSON(modifiedJSON));
  }

  const initialSize = population.length;
  assertEquals(initialSize, 200, "Initial population should be 200");

  // Run de-duplication
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform(population);

  // Verify no duplicates remain
  const uuids = new Set<string>();
  for (const c of population) {
    const uuid = CreatureUtil.makeUUID(c);
    assertFalse(uuids.has(uuid), `Duplicate found: ${uuid}`);
    uuids.add(uuid);
  }

  // We had 30 duplicates, so population should be reduced
  // But DeDuplicator replaces some duplicates rather than just removing them
  // So we just verify uniqueness, not exact count
});

/**
 * Test that Bloom filter correctly handles empty and small populations.
 */
Deno.test("BloomFilterDeDuplication - small population", () => {
  const creature: CreatureInternal = {
    neurons: [
      { bias: 0.1, index: 2, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 2 },
    ],
    input: 2,
    output: 1,
  };

  const neat = new Neat(2, 1, { populationSize: 5 }, []);
  const exportedCreature = Creature.fromJSON(creature).exportJSON();

  // Create very small population
  const population: Creature[] = [];
  for (let i = 0; i < 3; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = i * 0.1;
    population.push(Creature.fromJSON(modifiedJSON));
  }

  // Run de-duplication
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform(population);

  // All creatures should remain (no duplicates)
  assertEquals(population.length, 3, "All unique creatures should remain");
});

/**
 * Test that Bloom filter handles all-duplicate scenarios.
 */
Deno.test("BloomFilterDeDuplication - all duplicates", () => {
  const creature: CreatureInternal = {
    neurons: [
      { bias: 0.1, index: 2, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 2 },
    ],
    input: 2,
    output: 1,
  };

  const neat = new Neat(2, 1, { populationSize: 30 }, []);
  const exportedCreature = Creature.fromJSON(creature).exportJSON();

  // Create population where all creatures are identical
  const population: Creature[] = [];
  for (let i = 0; i < 50; i++) {
    population.push(Creature.fromJSON(exportedCreature));
  }

  // Run de-duplication
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform(population);

  // Verify no duplicates remain
  const uuids = new Set<string>();
  for (const c of population) {
    const uuid = CreatureUtil.makeUUID(c);
    assertFalse(uuids.has(uuid), `Duplicate found: ${uuid}`);
    uuids.add(uuid);
  }

  // Population should be at most populationSize
  assert(
    population.length <= neat.config.populationSize,
    "Population should not exceed configured size",
  );
});

/**
 * Test that the Bloom filter is properly cleared between calls.
 * Multiple perform() calls should not interfere with each other.
 */
Deno.test("BloomFilterDeDuplication - multiple perform calls", () => {
  const creature: CreatureInternal = {
    neurons: [
      { bias: 0.1, index: 2, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 2 },
    ],
    input: 2,
    output: 1,
  };

  const neat = new Neat(2, 1, { populationSize: 20 }, []);
  const exportedCreature = Creature.fromJSON(creature).exportJSON();

  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  // First perform call
  const population1: Creature[] = [];
  for (let i = 0; i < 10; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = i * 0.1;
    population1.push(Creature.fromJSON(modifiedJSON));
  }
  deDuplicator.perform(population1);
  assertEquals(population1.length, 10, "First call: all unique");

  // Second perform call with same creatures (should still work)
  const population2: Creature[] = [];
  for (let i = 0; i < 10; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = i * 0.1;
    population2.push(Creature.fromJSON(modifiedJSON));
  }
  deDuplicator.perform(population2);
  assertEquals(population2.length, 10, "Second call: Bloom filter was cleared");

  // Verify no duplicates in either population
  for (const pop of [population1, population2]) {
    const uuids = new Set<string>();
    for (const c of pop) {
      const uuid = CreatureUtil.makeUUID(c);
      assertFalse(uuids.has(uuid), `Duplicate found: ${uuid}`);
      uuids.add(uuid);
    }
  }
});

/**
 * Test that de-duplication works correctly with evolution.
 * This is an integration test that exercises the full path.
 */
Deno.test("BloomFilterDeDuplication - integration with evolution", async () => {
  const creature: CreatureInternal = {
    neurons: [
      { bias: 0, index: 2, type: "hidden", squash: "TANH" },
      { bias: 0.1, index: 3, type: "output", squash: "IDENTITY" },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 2 },
      { weight: 0.3, from: 1, to: 2 },
      { weight: 0.2, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  };

  const baseCreature = Creature.fromJSON(creature);

  // Simple XOR-like training set
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  // Run evolution for a few generations
  const results = await baseCreature.evolveDataSet(trainingSet, {
    iterations: 3,
    populationSize: 30,
    elitism: 3,
    threads: 1,
  });

  // Evolution should complete without errors
  assert(Number.isFinite(results.error), "Error should be finite");
  assert(results.error >= 0, "Error should be non-negative");
});
