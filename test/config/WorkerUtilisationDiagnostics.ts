/**
 * Tests for per-phase worker utilisation diagnostics.
 *
 * Issue #2312: Verifies that generation_complete events include worker
 * utilisation metrics per phase, and that the interfaces are correctly
 * populated during evolution.
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
  PhaseWorkerUtilisation,
  TrainingEvent,
  WorkerUtilisationSnapshot,
} from "@config/TrainingEvent.ts";

Deno.test("WorkerUtilisation - generation events include workerUtilisation field", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assertGreater(
    events.length,
    0,
    "Should emit at least one generation_complete event",
  );

  const first = events[0];
  assert(
    first.phaseTiming.workerUtilisation !== undefined,
    "workerUtilisation should be present in phaseTiming",
  );
});

Deno.test("WorkerUtilisation - snapshot has valid structure", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assertGreater(events.length, 0);
  const utilisation = events[0].phaseTiming
    .workerUtilisation as PhaseWorkerUtilisation;

  // Verify fitness snapshot structure
  const fitnessSnap = utilisation.fitness as WorkerUtilisationSnapshot;
  assert(fitnessSnap !== undefined, "fitness snapshot should exist");
  assertEquals(typeof fitnessSnap.fastActive, "number");
  assertEquals(typeof fitnessSnap.fastTotal, "number");
  assertEquals(typeof fitnessSnap.fastUtilisationPct, "number");
  assertEquals(typeof fitnessSnap.heavyActive, "number");
  assertEquals(typeof fitnessSnap.heavyTotal, "number");
  assertEquals(typeof fitnessSnap.heavyUtilisationPct, "number");

  // Utilisation percentages must be in [0, 100]
  assert(
    fitnessSnap.fastUtilisationPct >= 0 &&
      fitnessSnap.fastUtilisationPct <= 100,
    `fastUtilisationPct should be 0–100, got ${fitnessSnap.fastUtilisationPct}`,
  );
  assert(
    fitnessSnap.heavyUtilisationPct >= 0 &&
      fitnessSnap.heavyUtilisationPct <= 100,
    `heavyUtilisationPct should be 0–100, got ${fitnessSnap.heavyUtilisationPct}`,
  );
});

Deno.test("WorkerUtilisation - all phases have snapshots", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assertGreater(events.length, 0);
  const utilisation = events[0].phaseTiming
    .workerUtilisation as PhaseWorkerUtilisation;

  // All core phases should have snapshots
  assert(utilisation.fitness !== undefined, "fitness snapshot required");
  assert(utilisation.breeding !== undefined, "breeding snapshot required");
  assert(utilisation.sort !== undefined, "sort snapshot required");
  assert(
    utilisation.writeScores !== undefined,
    "writeScores snapshot required",
  );
  assert(utilisation.speciation !== undefined, "speciation snapshot required");
  assert(utilisation.mutation !== undefined, "mutation snapshot required");
  assert(
    utilisation.deduplication !== undefined,
    "deduplication snapshot required",
  );
  // preWarm is optional (may not run if 0ms)
});

Deno.test("WorkerUtilisation - overallCpuUtilisationPct is a valid percentage", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assertGreater(events.length, 0);
  const utilisation = events[0].phaseTiming
    .workerUtilisation as PhaseWorkerUtilisation;

  assert(
    utilisation.overallCpuUtilisationPct !== undefined,
    "overallCpuUtilisationPct should be present",
  );
  assert(
    utilisation.overallCpuUtilisationPct >= 0 &&
      utilisation.overallCpuUtilisationPct <= 100,
    `overallCpuUtilisationPct should be 0–100, got ${utilisation.overallCpuUtilisationPct}`,
  );
});

Deno.test("WorkerUtilisation - single-thread mode reports correct totals", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assertGreater(events.length, 0);
  const utilisation = events[0].phaseTiming
    .workerUtilisation as PhaseWorkerUtilisation;

  // In single-thread mode, worker pools exist but have minimal workers.
  // The key invariant is that fastTotal and heavyTotal are >= 0.
  const fitnessSnap = utilisation.fitness as WorkerUtilisationSnapshot;
  assert(
    fitnessSnap.fastTotal >= 0,
    "fastTotal should be non-negative",
  );
  assert(
    fitnessSnap.heavyTotal >= 0,
    "heavyTotal should be non-negative",
  );
  // Active count must never exceed total
  assert(
    fitnessSnap.fastActive <= fitnessSnap.fastTotal,
    "fastActive must not exceed fastTotal",
  );
  assert(
    fitnessSnap.heavyActive <= fitnessSnap.heavyTotal,
    "heavyActive must not exceed heavyTotal",
  );
});
