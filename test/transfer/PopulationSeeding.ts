/**
 * Tests for population seeding with pre-trained creatures.
 *
 * Issue #1861: Verifies that populations can be seeded with pre-trained
 * creatures alongside randomly initialised ones.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { createSeededPopulation } from "@transfer/PopulationSeeding.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("createSeededPopulation - seeds included in population", async () => {
  await initWasmForTests();

  const seed1 = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });
  const seed2 = new Creature(2, 1, {
    layers: [{ count: 2, squash: "LOGISTIC" }],
  });

  const population = createSeededPopulation({
    inputCount: 2,
    outputCount: 1,
    populationSize: 10,
    seeds: [seed1.exportJSON(), seed2.exportJSON()],
  });

  assertEquals(population.length, 10, "Population should match target size");

  // First two should be the seeds
  assertEquals(population[0].input, 2);
  assertEquals(population[1].input, 2);
});

Deno.test("createSeededPopulation - random creatures fill remaining slots", async () => {
  await initWasmForTests();

  const seed = new Creature(3, 2, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const population = createSeededPopulation({
    inputCount: 3,
    outputCount: 2,
    populationSize: 5,
    seeds: [seed.exportJSON()],
  });

  assertEquals(population.length, 5, "Population should match target size");

  // First is the seed, rest are random
  assertEquals(population[0].input, 3);
  assertEquals(population[0].output, 2);

  // All creatures should have correct dimensions
  for (const creature of population) {
    assertEquals(creature.input, 3);
    assertEquals(creature.output, 2);
  }
});

Deno.test("createSeededPopulation - more seeds than population size caps at population size", async () => {
  await initWasmForTests();

  const seeds = [];
  for (let i = 0; i < 15; i++) {
    const seed = new Creature(2, 1);
    seeds.push(seed.exportJSON());
  }

  const population = createSeededPopulation({
    inputCount: 2,
    outputCount: 1,
    populationSize: 10,
    seeds,
  });

  assertEquals(
    population.length,
    10,
    "Population should not exceed target size",
  );
});

Deno.test("createSeededPopulation - empty seeds returns all random", async () => {
  await initWasmForTests();

  const population = createSeededPopulation({
    inputCount: 2,
    outputCount: 1,
    populationSize: 5,
    seeds: [],
  });

  assertEquals(population.length, 5, "Population should match target size");

  // All should be valid creature exports
  for (const creatureExport of population) {
    const creature = Creature.fromJSON(creatureExport, true);
    assertEquals(creature.input, 2);
    assertEquals(creature.output, 1);
  }
});

Deno.test("createSeededPopulation - with layer configuration", async () => {
  await initWasmForTests();

  const seed = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const population = createSeededPopulation({
    inputCount: 2,
    outputCount: 1,
    populationSize: 5,
    seeds: [seed.exportJSON()],
    layers: [{ count: 3, squash: "LOGISTIC" }],
  });

  assertEquals(population.length, 5);

  // Random creatures (indices 1-4) should have the specified layer configuration
  for (let i = 1; i < population.length; i++) {
    const creature = Creature.fromJSON(population[i], true);
    assertEquals(creature.input, 2);
    assertEquals(creature.output, 1);
    // Should have hidden neurons from the layer spec
    let hiddenCount = 0;
    for (const n of creature.neurons) {
      if (n.type === "hidden") hiddenCount++;
    }
    assertEquals(
      hiddenCount,
      3,
      `Random creature ${i} should have 3 hidden neurons`,
    );
  }
});

Deno.test("seeded population creatures can be activated", async () => {
  await initWasmForTests();

  const seed = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const population = createSeededPopulation({
    inputCount: 2,
    outputCount: 1,
    populationSize: 3,
    seeds: [seed.exportJSON()],
  });

  // All creatures in the population should be activatable
  for (const creatureExport of population) {
    const creature = Creature.fromJSON(creatureExport, true);
    const output = creature.activate(new Float32Array([0.5, 0.5]));
    assert(output.length === 1, "Should produce 1 output");
    assert(Number.isFinite(output[0]), "Output should be finite");
  }
});
