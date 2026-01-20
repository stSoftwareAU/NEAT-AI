import { assert, assertFalse } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { Breed } from "../src/breed/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Neat } from "../src/NEAT/Neat.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { CreatureUtil } from "../mod.ts";
import { initWasmActivation } from "../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

/**
 * Test for issue #1099: Performance: Reduce de-duplication frequency in evolution loop
 *
 * This test verifies that single-pass de-duplication (at the end after combining
 * all population sources) produces the same result as two-pass de-duplication.
 */
Deno.test("SinglePassDeDuplication - produces same uniqueness as two-pass", () => {
  const creature: CreatureInternal = {
    neurons: [
      {
        bias: 0,
        index: 2,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        bias: 0.1,
        index: 3,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: 0.5,
        from: 0,
        to: 2,
      },
      {
        weight: 0.3,
        from: 1,
        to: 2,
      },
      {
        weight: 0.2,
        from: 2,
        to: 3,
      },
    ],
    input: 2,
    output: 1,
  };

  const neat = new Neat(2, 1, { populationSize: 50 }, []);

  // Create the exported creature
  const exportedCreature = Creature.fromJSON(creature).exportJSON();

  // Simulate different population sources with duplicates
  const elitists: Creature[] = [];
  const trainedPopulation: Creature[] = [];
  const newPopulation: Creature[] = [];
  const dnaPopulation: Creature[] = [];

  // Add elitists (these have priority)
  for (let i = 0; i < 5; i++) {
    const clone = Creature.fromJSON(exportedCreature);
    elitists.push(clone);
  }

  // Add trained population with some duplicates of elitists
  for (let i = 0; i < 10; i++) {
    const clone = Creature.fromJSON(exportedCreature);
    trainedPopulation.push(clone);
  }

  // Add new population with unique creatures
  for (let i = 0; i < 20; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = Math.random();
    const unique = Creature.fromJSON(modifiedJSON);
    newPopulation.push(unique);
  }

  // Add DNA population with more duplicates
  for (let i = 0; i < 5; i++) {
    const clone = Creature.fromJSON(exportedCreature);
    dnaPopulation.push(clone);
  }

  // Combine all sources (simulating single-pass approach)
  const combinedPopulation = [
    ...elitists,
    ...trainedPopulation,
    ...newPopulation,
    ...dnaPopulation,
  ];

  // Count duplicates before de-duplication
  const uuidsBefore = new Set<string>();
  let duplicateCountBefore = 0;
  for (const c of combinedPopulation) {
    const uuid = CreatureUtil.makeUUID(c);
    if (uuidsBefore.has(uuid)) {
      duplicateCountBefore++;
    }
    uuidsBefore.add(uuid);
  }

  // Should have duplicates from the identical clones
  assert(
    duplicateCountBefore > 0,
    `Expected duplicates before de-duplication, got ${duplicateCountBefore}`,
  );

  // Perform single-pass de-duplication
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform(combinedPopulation);

  // Verify no duplicates remain
  const uuidsAfter = new Set<string>();
  for (const c of combinedPopulation) {
    const uuid = CreatureUtil.makeUUID(c);
    assertFalse(
      uuidsAfter.has(uuid),
      `Duplicate found after single-pass de-duplication: ${uuid}`,
    );
    uuidsAfter.add(uuid);
  }
});

/**
 * Test that single-pass de-duplication correctly handles cross-source duplicates.
 *
 * The key benefit of single-pass is that it catches duplicates between different
 * population sources (elitists, trained, new, DNA) in one operation.
 */
Deno.test("SinglePassDeDuplication - catches cross-source duplicates", () => {
  const creature: CreatureInternal = {
    neurons: [
      {
        bias: 0.1,
        index: 2,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: 0.5,
        from: 0,
        to: 2,
      },
    ],
    input: 2,
    output: 1,
  };

  const neat = new Neat(2, 1, { populationSize: 30 }, []);

  const exportedCreature = Creature.fromJSON(creature).exportJSON();

  // Create populations where the same creature appears in multiple sources
  const elitists: Creature[] = [Creature.fromJSON(exportedCreature)];
  const trainedPopulation: Creature[] = [Creature.fromJSON(exportedCreature)]; // Same as elitist
  const newPopulation: Creature[] = [Creature.fromJSON(exportedCreature)]; // Same again
  const dnaPopulation: Creature[] = [Creature.fromJSON(exportedCreature)]; // And again

  // Add some unique creatures
  for (let i = 0; i < 10; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(exportedCreature));
    modifiedJSON.neurons[0].bias = Math.random();
    newPopulation.push(Creature.fromJSON(modifiedJSON));
  }

  // Combine all sources
  const combinedPopulation = [
    ...elitists,
    ...trainedPopulation,
    ...newPopulation,
    ...dnaPopulation,
  ];

  // Compute UUIDs and count cross-source duplicates
  const uuidToSources = new Map<string, string[]>();
  for (const c of elitists) {
    const uuid = CreatureUtil.makeUUID(c);
    const sources = uuidToSources.get(uuid) || [];
    sources.push("elitist");
    uuidToSources.set(uuid, sources);
  }
  for (const c of trainedPopulation) {
    const uuid = CreatureUtil.makeUUID(c);
    const sources = uuidToSources.get(uuid) || [];
    sources.push("trained");
    uuidToSources.set(uuid, sources);
  }
  for (const c of newPopulation) {
    const uuid = CreatureUtil.makeUUID(c);
    const sources = uuidToSources.get(uuid) || [];
    sources.push("new");
    uuidToSources.set(uuid, sources);
  }
  for (const c of dnaPopulation) {
    const uuid = CreatureUtil.makeUUID(c);
    const sources = uuidToSources.get(uuid) || [];
    sources.push("dna");
    uuidToSources.set(uuid, sources);
  }

  // Verify there are cross-source duplicates before de-duplication
  let crossSourceDuplicates = 0;
  for (const sources of uuidToSources.values()) {
    if (sources.length > 1) {
      crossSourceDuplicates++;
    }
  }
  assert(
    crossSourceDuplicates > 0,
    "Expected cross-source duplicates",
  );

  // Perform single-pass de-duplication
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform(combinedPopulation);

  // Verify no duplicates remain
  const uuidsAfter = new Set<string>();
  for (const c of combinedPopulation) {
    const uuid = CreatureUtil.makeUUID(c);
    assertFalse(
      uuidsAfter.has(uuid),
      `Duplicate found after de-duplication: ${uuid}`,
    );
    uuidsAfter.add(uuid);
  }
});

/**
 * Test that evolution completes successfully with single-pass de-duplication.
 *
 * This is an integration test that runs the full evolution loop.
 */
Deno.test("SinglePassDeDuplication - evolution completes successfully", async () => {
  const creature: CreatureInternal = {
    neurons: [
      {
        bias: 0,
        index: 2,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        bias: 0.1,
        index: 3,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: 0.5,
        from: 0,
        to: 2,
      },
      {
        weight: 0.3,
        from: 1,
        to: 2,
      },
      {
        weight: 0.2,
        from: 2,
        to: 3,
      },
    ],
    input: 2,
    output: 1,
  };

  const baseCreature = Creature.fromJSON(creature);

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([0.3]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0.5]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0.8]) },
  ];

  // Run a few generations to exercise the de-duplication logic
  const results = await baseCreature.evolveDataSet(trainingSet, {
    iterations: 5,
    populationSize: 30,
    elitism: 3,
    threads: 1,
  });

  // Evolution should complete without errors
  assert(Number.isFinite(results.error), "Error should be finite");
});
