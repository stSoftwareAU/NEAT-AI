/**
 * Tests for breeding sub-phase timing instrumentation.
 *
 * Issue #2284: Verifies that sub-phase timing data is correctly collected
 * and structured when breeding offspring. These are "what" tests — they
 * verify the shape and population of timing data, not actual timing values
 * (which are unreliable in parallel test execution).
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "@creature";
import { Offspring } from "@architecture/Offspring.ts";
import { BreedingSubPhaseAccumulator } from "@breed/BreedingSubPhaseAccumulator.ts";
import { ParallelBreeding } from "@breed/ParallelBreeding.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { BreedingSubPhaseTiming } from "@config/TrainingEvent.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Simple seeded random number generator for reproducible test creatures.
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Creates a test creature with a valid chain topology.
 */
function createTestCreature(
  inputCount: number,
  outputCount: number,
  hiddenCount: number,
  prefix: string,
  seed: number,
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const random = seededRandom(seed);

  const squashOptions = ["TANH", "IDENTITY", "LeakyReLU", "LOGISTIC", "RELU"];
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-hidden-${i}`,
      squash: squashOptions[Math.floor(random() * squashOptions.length)],
      bias: (random() - 0.5) * 2,
    });
  }

  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: (random() - 0.5) * 0.5,
    });
  }

  for (let i = 0; i < inputCount; i++) {
    for (let j = 0; j < Math.min(hiddenCount, 3); j++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: `${prefix}-hidden-${j}`,
        weight: (random() - 0.5) * 2,
      });
    }
  }

  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-hidden-${i}`,
      toUUID: `${prefix}-hidden-${i + 1}`,
      weight: (random() - 0.5) * 2,
    });
  }

  if (hiddenCount > 0) {
    for (let j = 0; j < outputCount; j++) {
      synapses.push({
        fromUUID: `${prefix}-hidden-${hiddenCount - 1}`,
        toUUID: `output-${j}`,
        weight: (random() - 0.5) * 2,
      });
    }
  } else {
    for (let i = 0; i < inputCount; i++) {
      for (let j = 0; j < outputCount; j++) {
        synapses.push({
          fromUUID: `input-${i}`,
          toUUID: `output-${j}`,
          weight: (random() - 0.5) * 2,
        });
      }
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
 * Creates a population for testing with scored creatures.
 */
function createTestPopulation(
  size: number,
  inputCount: number,
  outputCount: number,
): { genus: Genus } {
  const genus = new Genus();

  for (let i = 0; i < size; i++) {
    const hiddenCount = 5 + (i % 8);
    const seed = 42 + i * 7919;
    const creature = createTestCreature(
      inputCount,
      outputCount,
      hiddenCount,
      `creature-${i}`,
      seed,
    );
    creature.score = -0.5 + (i / size) * 0.3;
    CreatureUtil.makeUUID(creature);
    genus.addCreature(creature);
  }

  return { genus };
}

Deno.test("BreedingSubPhaseAccumulator - toTiming returns all fields", () => {
  const acc = new BreedingSubPhaseAccumulator();
  acc.parentSelectionMs = 10;
  acc.geneticCompatibilityMs = 20;
  acc.alignmentCrossoverMs = 30;
  acc.sortNeuronsMs = 15;
  acc.batchConnectionMs = 5;
  acc.postBreedingRepairMs = 8;
  acc.offspringCount = 3;

  const timing = acc.toTiming();

  assertEquals(timing.parentSelectionMs, 10);
  assertEquals(timing.geneticCompatibilityMs, 20);
  assertEquals(timing.alignmentCrossoverMs, 30);
  assertEquals(timing.sortNeuronsMs, 15);
  assertEquals(timing.batchConnectionMs, 5);
  assertEquals(timing.postBreedingRepairMs, 8);
  assertEquals(timing.offspringCount, 3);
});

Deno.test("BreedingSubPhaseAccumulator - toTiming returns frozen object", () => {
  const acc = new BreedingSubPhaseAccumulator();
  const timing = acc.toTiming();

  // The returned object should be frozen (immutable)
  assert(Object.isFrozen(timing), "Timing snapshot should be frozen");
});

Deno.test("BreedingSubPhaseAccumulator - accumulates across multiple calls", () => {
  const acc = new BreedingSubPhaseAccumulator();

  // Simulate two offspring contributions
  acc.geneticCompatibilityMs += 5;
  acc.alignmentCrossoverMs += 10;
  acc.sortNeuronsMs += 3;
  acc.batchConnectionMs += 2;
  acc.postBreedingRepairMs += 1;
  acc.offspringCount++;

  acc.geneticCompatibilityMs += 7;
  acc.alignmentCrossoverMs += 12;
  acc.sortNeuronsMs += 4;
  acc.batchConnectionMs += 3;
  acc.postBreedingRepairMs += 2;
  acc.offspringCount++;

  const timing = acc.toTiming();
  assertEquals(timing.geneticCompatibilityMs, 12);
  assertEquals(timing.alignmentCrossoverMs, 22);
  assertEquals(timing.sortNeuronsMs, 7);
  assertEquals(timing.batchConnectionMs, 5);
  assertEquals(timing.postBreedingRepairMs, 3);
  assertEquals(timing.offspringCount, 2);
});

Deno.test("Offspring.breed - populates sub-phase accumulator when provided", () => {
  const mother = createTestCreature(4, 2, 6, "mum", 100);
  const father = createTestCreature(4, 2, 6, "dad", 200);

  const acc = new BreedingSubPhaseAccumulator();

  const child = Offspring.breed(mother, father, {
    subPhaseAccumulator: acc,
  });

  if (child) {
    // Successful breeding should increment offspring count
    assertEquals(acc.offspringCount, 1, "Offspring count should be 1");

    // All sub-phase fields should be non-negative numbers
    assert(
      acc.geneticCompatibilityMs >= 0,
      "geneticCompatibilityMs should be >= 0",
    );
    assert(
      acc.alignmentCrossoverMs >= 0,
      "alignmentCrossoverMs should be >= 0",
    );
    assert(acc.sortNeuronsMs >= 0, "sortNeuronsMs should be >= 0");
    assert(acc.batchConnectionMs >= 0, "batchConnectionMs should be >= 0");
    assert(
      acc.postBreedingRepairMs >= 0,
      "postBreedingRepairMs should be >= 0",
    );
  }
  // If child is undefined (breeding failed), offspring count should be 0
  // Either outcome is valid — we're testing the instrumentation, not breeding success
});

Deno.test("Offspring.breed - accumulator is additive across multiple breedings", () => {
  const acc = new BreedingSubPhaseAccumulator();
  let successCount = 0;

  // Breed multiple offspring with the same accumulator
  for (let i = 0; i < 5; i++) {
    const mother = createTestCreature(3, 1, 4 + i, `mum-${i}`, 300 + i * 10);
    const father = createTestCreature(3, 1, 4 + i, `dad-${i}`, 400 + i * 10);

    const child = Offspring.breed(mother, father, {
      subPhaseAccumulator: acc,
    });
    if (child) successCount++;
  }

  // The accumulator should reflect the number of successful breedings
  assertEquals(
    acc.offspringCount,
    successCount,
    "Offspring count should match successful breedings",
  );
});

Deno.test("Offspring.breed - works without accumulator (backward compatible)", () => {
  const mother = createTestCreature(4, 2, 6, "compat-mum", 500);
  const father = createTestCreature(4, 2, 6, "compat-dad", 600);

  // Should work without providing subPhaseAccumulator
  const child = Offspring.breed(mother, father, {});

  // No assertion on child success — just verifying no errors thrown
  if (child) {
    child.validate();
  }
});

Deno.test("ParallelBreeding - breedBatch populates lastBreedingSubPhases", async () => {
  const { genus } = createTestPopulation(30, 4, 2);
  const config = createNeatConfig({
    populationSize: 30,
    geneticCompatibilityThreshold: 0.3,
  });

  const parallelBreeding = new ParallelBreeding(genus, config);

  // Initially undefined
  assertEquals(
    parallelBreeding.lastBreedingSubPhases,
    undefined,
    "Should be undefined before first breedBatch",
  );

  const offspring = await parallelBreeding.breedBatch(10);

  // After breeding, sub-phase timing should be populated
  const subPhases = parallelBreeding.lastBreedingSubPhases;
  assertExists(
    subPhases,
    "lastBreedingSubPhases should exist after breedBatch",
  );

  // Validate the shape of the timing data
  assertExists(subPhases.parentSelectionMs, "Should have parentSelectionMs");
  assert(
    typeof subPhases.parentSelectionMs === "number",
    "parentSelectionMs should be a number",
  );
  assert(
    typeof subPhases.geneticCompatibilityMs === "number",
    "geneticCompatibilityMs should be a number",
  );
  assert(
    typeof subPhases.alignmentCrossoverMs === "number",
    "alignmentCrossoverMs should be a number",
  );
  assert(
    typeof subPhases.sortNeuronsMs === "number",
    "sortNeuronsMs should be a number",
  );
  assert(
    typeof subPhases.batchConnectionMs === "number",
    "batchConnectionMs should be a number",
  );
  assert(
    typeof subPhases.postBreedingRepairMs === "number",
    "postBreedingRepairMs should be a number",
  );
  assert(
    typeof subPhases.offspringCount === "number",
    "offspringCount should be a number",
  );

  // Offspring count should match actual offspring produced
  assertEquals(
    subPhases.offspringCount,
    offspring.length,
    "offspringCount should match actual offspring produced",
  );

  // All timing values should be non-negative
  assert(subPhases.parentSelectionMs >= 0, "parentSelectionMs >= 0");
  assert(subPhases.geneticCompatibilityMs >= 0, "geneticCompatibilityMs >= 0");
  assert(subPhases.alignmentCrossoverMs >= 0, "alignmentCrossoverMs >= 0");
  assert(subPhases.sortNeuronsMs >= 0, "sortNeuronsMs >= 0");
  assert(subPhases.batchConnectionMs >= 0, "batchConnectionMs >= 0");
  assert(subPhases.postBreedingRepairMs >= 0, "postBreedingRepairMs >= 0");
  assert(subPhases.offspringCount >= 0, "offspringCount >= 0");
});

Deno.test("ParallelBreeding - empty batch clears lastBreedingSubPhases", async () => {
  const { genus } = createTestPopulation(10, 3, 1);
  const config = createNeatConfig({ populationSize: 10 });

  const parallelBreeding = new ParallelBreeding(genus, config);
  await parallelBreeding.breedBatch(0);

  assertEquals(
    parallelBreeding.lastBreedingSubPhases,
    undefined,
    "Empty batch should clear sub-phases",
  );
});

Deno.test("BreedingSubPhaseTiming - included in GenerationPhaseTiming via evolveDataSet", async () => {
  // Build a small creature and evolve for one generation to capture the event
  const creature = new Creature(3, 1);

  const trainingSet = [
    { input: new Float32Array([0, 0, 1]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1, 0]), output: new Float32Array([0.5]) },
  ];

  let capturedSubPhases: BreedingSubPhaseTiming | undefined;

  await creature.evolveDataSet(trainingSet, {
    iterations: 2,
    targetError: 0,
    populationSize: 20,
    threads: 1,
    onTrainingEvent: (event) => {
      if (event.kind === "generation_complete") {
        if (event.phaseTiming.breedingSubPhases) {
          capturedSubPhases = event.phaseTiming.breedingSubPhases;
        }
      }
    },
  });

  // Sub-phase timing should have been captured from at least one generation
  assertExists(
    capturedSubPhases,
    "breedingSubPhases should be present in phaseTiming",
  );

  // Verify all fields are present and are numbers
  const fields: (keyof BreedingSubPhaseTiming)[] = [
    "parentSelectionMs",
    "geneticCompatibilityMs",
    "alignmentCrossoverMs",
    "sortNeuronsMs",
    "batchConnectionMs",
    "postBreedingRepairMs",
    "offspringCount",
  ];

  for (const field of fields) {
    assert(
      typeof capturedSubPhases[field] === "number",
      `${field} should be a number, got ${typeof capturedSubPhases[field]}`,
    );
    assert(
      capturedSubPhases[field] >= 0,
      `${field} should be >= 0`,
    );
  }
});
