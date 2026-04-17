/**
 * Tests for Issue #2323: Split breeding wall-time from overlapped main-thread work.
 *
 * Verifies that generation_complete timing includes unambiguous fields that
 * distinguish worker breeding time from overlapped main-thread time:
 *   - breedingMs: wall-clock interval (backward compatible)
 *   - breedingWorkerMs: actual worker/breeding duration
 *   - mainThreadOverlapMs: main-thread work done concurrently with breeding
 *
 * The semantic invariant is:
 *   breedingMs >= breedingWorkerMs (wall-clock >= worker time because
 *     the wall-clock measurement includes the time before/after workers)
 *   breedingMs >= mainThreadOverlapMs (overlap cannot exceed wall-clock)
 *   breedingWorkerMs + mainThreadOverlapMs >= breedingMs (combined work
 *     covers the wall-clock window, possibly exceeding it when both run
 *     concurrently)
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
  GenerationPhaseTiming,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

Deno.test("BreedingTimingSplit: breedingWorkerMs and mainThreadOverlapMs are present", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 20,
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

  for (const event of events) {
    assert(event.phaseTiming, "Event should include phaseTiming");
    const timing = event.phaseTiming;

    // Issue #2323: breedingWorkerMs should be present and non-negative
    assert(
      timing.breedingWorkerMs !== undefined,
      "breedingWorkerMs should be present",
    );
    assertEquals(typeof timing.breedingWorkerMs, "number");
    assertGreater(
      timing.breedingWorkerMs!,
      -1,
      "breedingWorkerMs should be non-negative",
    );

    // Issue #2323: mainThreadOverlapMs should be present and non-negative
    assert(
      timing.mainThreadOverlapMs !== undefined,
      "mainThreadOverlapMs should be present",
    );
    assertEquals(typeof timing.mainThreadOverlapMs, "number");
    assertGreater(
      timing.mainThreadOverlapMs!,
      -1,
      "mainThreadOverlapMs should be non-negative",
    );

    // Backward compatibility: breedingMs is still present
    assertEquals(typeof timing.breedingMs, "number");
    assertGreater(timing.breedingMs, -1, "breedingMs should be non-negative");
  }
});

Deno.test("BreedingTimingSplit: semantic invariants hold between timing fields", async () => {
  const timings: GenerationPhaseTiming[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 20,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        timings.push(event.phaseTiming);
      }
    },
  });

  assertGreater(timings.length, 0, "Should capture at least one timing");

  for (const timing of timings) {
    const workerMs = timing.breedingWorkerMs ?? 0;
    const overlapMs = timing.mainThreadOverlapMs ?? 0;

    // Issue #2323: Wall-clock breedingMs >= worker time (with 1ms tolerance
    // for timer resolution).
    assert(
      timing.breedingMs >= workerMs - 1,
      `breedingMs (${timing.breedingMs}) should be >= breedingWorkerMs (${workerMs})`,
    );

    // Issue #2323: Wall-clock breedingMs >= overlap time (with tolerance).
    assert(
      timing.breedingMs >= overlapMs - 1,
      `breedingMs (${timing.breedingMs}) should be >= mainThreadOverlapMs (${overlapMs})`,
    );
  }
});

Deno.test("BreedingTimingSplit: fields are optional for backward compatibility", () => {
  // Verify that GenerationPhaseTiming still accepts objects without the new fields
  const timingWithout: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 170,
  };
  assertEquals(timingWithout.breedingWorkerMs, undefined);
  assertEquals(timingWithout.mainThreadOverlapMs, undefined);

  // Verify the type accepts objects with the new fields
  const timingWith: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 170,
    breedingWorkerMs: 35,
    mainThreadOverlapMs: 18,
  };
  assertEquals(timingWith.breedingWorkerMs, 35);
  assertEquals(timingWith.mainThreadOverlapMs, 18);
});

Deno.test("BreedingTimingSplit: timing invariant holds with new fields included", async () => {
  const timings: GenerationPhaseTiming[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 20,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        timings.push(event.phaseTiming);
      }
    },
  });

  assertGreater(timings.length, 0, "Should capture at least one timing");

  for (const timing of timings) {
    // The existing timing invariant should still hold
    const measuredPhases = timing.fitnessMs + timing.breedingMs +
      timing.resultProcessingMs +
      (timing.mutationMs ?? 0) +
      (timing.deduplicationMs ?? 0) +
      (timing.speciationMs ?? 0) +
      (timing.sortMs ?? 0) +
      (timing.writeScoresMs ?? 0) +
      (timing.memoryEvictionMs ?? 0) +
      (timing.preWarmMs ?? 0);
    const overlap = timing.pipelineOverlapMs ?? 0;
    assert(
      timing.totalMs >= measuredPhases - overlap - 1,
      `totalMs (${timing.totalMs}) should be >= sum (${measuredPhases}) - overlap (${overlap})`,
    );
  }
});
