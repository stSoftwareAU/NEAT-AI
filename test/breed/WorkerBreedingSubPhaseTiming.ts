/**
 * Tests for worker-path breeding sub-phase telemetry.
 *
 * Issue #2324: Verifies that breeding sub-phase timing is captured and
 * aggregated when breeding runs through the worker path, not just the
 * main-thread fallback path. These are "what" tests — they verify the
 * presence and shape of timing data, not actual timing values (which
 * are unreliable in parallel test execution).
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "@creature";
import { Offspring } from "@architecture/Offspring.ts";
import { ParallelBreeding } from "@breed/ParallelBreeding.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { BreedingSubPhaseAccumulator } from "@breed/BreedingSubPhaseAccumulator.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { BreedingSubPhaseTiming } from "@config/TrainingEvent.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";

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

/**
 * Creates a mock worker that breeds on the main thread and returns
 * sub-phase timing data in the response, simulating a real worker
 * that has been instrumented with sub-phase telemetry (Issue #2324).
 */
function createMockWorkerWithTiming(): WorkerHandler {
  return {
    breed(
      mother: Creature,
      father: Creature,
      geneticCompatibilityThreshold: number,
      forwardOnly: boolean,
    ) {
      try {
        const acc = new BreedingSubPhaseAccumulator();
        const child = Offspring.breed(mother, father, {
          geneticCompatibilityThreshold,
          forwardOnly,
          subPhaseAccumulator: acc,
        });

        if (child) {
          const timing = acc.toTiming();
          return Promise.resolve({
            taskID: 0,
            duration: 1,
            breed: {
              success: true,
              offspring: child.exportJSON(),
              subPhaseTiming: timing,
            },
          });
        }
      } catch {
        // Breeding can fail — this is expected
      }

      return Promise.resolve({
        taskID: 0,
        duration: 1,
        breed: { success: false },
      });
    },
  } as unknown as WorkerHandler;
}

Deno.test("Worker-path breeding populates lastBreedingSubPhases", async () => {
  const { genus } = createTestPopulation(50, 5, 2);
  const config = createNeatConfig({
    populationSize: 50,
    geneticCompatibilityThreshold: 0.3,
  });

  const mockWorkers = [
    createMockWorkerWithTiming(),
    createMockWorkerWithTiming(),
    createMockWorkerWithTiming(),
  ];
  const parallelBreeding = new ParallelBreeding(genus, config, mockWorkers);

  const offspring = await parallelBreeding.breedBatch(30);
  assert(offspring.length > 0, "Should produce offspring via worker path");

  const subPhases = parallelBreeding.lastBreedingSubPhases;
  assertExists(
    subPhases,
    "lastBreedingSubPhases should exist after worker-path breedBatch",
  );

  // All sub-phase fields should be present and non-negative
  assert(
    typeof subPhases.parentSelectionMs === "number" &&
      subPhases.parentSelectionMs >= 0,
    "parentSelectionMs should be a non-negative number",
  );
  assert(
    typeof subPhases.geneticCompatibilityMs === "number" &&
      subPhases.geneticCompatibilityMs >= 0,
    "geneticCompatibilityMs should be a non-negative number",
  );
  assert(
    typeof subPhases.alignmentCrossoverMs === "number" &&
      subPhases.alignmentCrossoverMs >= 0,
    "alignmentCrossoverMs should be a non-negative number",
  );
  assert(
    typeof subPhases.sortNeuronsMs === "number" &&
      subPhases.sortNeuronsMs >= 0,
    "sortNeuronsMs should be a non-negative number",
  );
  assert(
    typeof subPhases.batchConnectionMs === "number" &&
      subPhases.batchConnectionMs >= 0,
    "batchConnectionMs should be a non-negative number",
  );
  assert(
    typeof subPhases.postBreedingRepairMs === "number" &&
      subPhases.postBreedingRepairMs >= 0,
    "postBreedingRepairMs should be a non-negative number",
  );

  // Offspring count should match actual offspring produced
  assertEquals(
    subPhases.offspringCount,
    offspring.length,
    "offspringCount should match actual offspring produced",
  );
});

Deno.test("Worker-path breeding aggregates timing across multiple workers", async () => {
  const { genus } = createTestPopulation(50, 5, 2);
  const config = createNeatConfig({
    populationSize: 50,
    geneticCompatibilityThreshold: 0.3,
  });

  // Use multiple workers so timing gets aggregated from all of them
  const mockWorkers = [
    createMockWorkerWithTiming(),
    createMockWorkerWithTiming(),
  ];
  const parallelBreeding = new ParallelBreeding(genus, config, mockWorkers);

  const offspring = await parallelBreeding.breedBatch(20);
  assert(offspring.length > 0, "Should produce offspring");

  const subPhases = parallelBreeding.lastBreedingSubPhases;
  assertExists(subPhases, "Sub-phases should exist");

  // The offspringCount should match actual offspring from worker results
  assertEquals(
    subPhases.offspringCount,
    offspring.length,
    "offspringCount should aggregate across all workers",
  );
});

Deno.test("Worker-path breeding sub-phases include parent selection timing", async () => {
  const { genus } = createTestPopulation(30, 4, 2);
  const config = createNeatConfig({
    populationSize: 30,
    geneticCompatibilityThreshold: 0.3,
  });

  const mockWorkers = [createMockWorkerWithTiming()];
  const parallelBreeding = new ParallelBreeding(genus, config, mockWorkers);

  await parallelBreeding.breedBatch(10);

  const subPhases = parallelBreeding.lastBreedingSubPhases;
  assertExists(subPhases, "Sub-phases should exist");

  // Parent selection happens on the main thread even for worker path,
  // so it should always be captured
  assert(
    typeof subPhases.parentSelectionMs === "number",
    "parentSelectionMs should be a number",
  );
  assert(
    subPhases.parentSelectionMs >= 0,
    "parentSelectionMs should be >= 0",
  );
});

Deno.test("Worker-path breeding sub-phases - all timing fields match BreedingSubPhaseTiming shape", async () => {
  const { genus } = createTestPopulation(30, 4, 2);
  const config = createNeatConfig({
    populationSize: 30,
    geneticCompatibilityThreshold: 0.3,
  });

  const mockWorkers = [
    createMockWorkerWithTiming(),
    createMockWorkerWithTiming(),
  ];
  const parallelBreeding = new ParallelBreeding(genus, config, mockWorkers);

  await parallelBreeding.breedBatch(15);

  const subPhases = parallelBreeding.lastBreedingSubPhases;
  assertExists(subPhases, "Sub-phases should exist");

  // Verify every field from BreedingSubPhaseTiming is present
  const expectedFields: (keyof BreedingSubPhaseTiming)[] = [
    "parentSelectionMs",
    "geneticCompatibilityMs",
    "alignmentCrossoverMs",
    "sortNeuronsMs",
    "batchConnectionMs",
    "postBreedingRepairMs",
    "offspringCount",
  ];

  for (const field of expectedFields) {
    assert(
      typeof subPhases[field] === "number",
      `${field} should be a number, got ${typeof subPhases[field]}`,
    );
    assert(
      subPhases[field] >= 0,
      `${field} should be >= 0, got ${subPhases[field]}`,
    );
  }
});

Deno.test("Worker-path breeding - failed worker responses do not contribute to sub-phases", async () => {
  const { genus } = createTestPopulation(30, 4, 2);
  const config = createNeatConfig({
    populationSize: 30,
    geneticCompatibilityThreshold: 0.3,
  });

  // Create a mock worker that always fails — no sub-phase timing returned
  const failingWorker = {
    breed(
      _mother: Creature,
      _father: Creature,
      _geneticCompatibilityThreshold: number,
      _forwardOnly: boolean,
    ) {
      return Promise.resolve({
        taskID: 0,
        duration: 1,
        breed: { success: false },
      });
    },
  } as unknown as WorkerHandler;

  const parallelBreeding = new ParallelBreeding(
    genus,
    config,
    [failingWorker],
  );

  await parallelBreeding.breedBatch(10);

  const subPhases = parallelBreeding.lastBreedingSubPhases;
  assertExists(
    subPhases,
    "Sub-phases should still exist (with parent selection)",
  );

  // No successful offspring, so offspringCount should be 0
  assertEquals(
    subPhases.offspringCount,
    0,
    "Failed breedings should not count as offspring",
  );
});
