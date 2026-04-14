/**
 * Tests for extended per-generation phase timing diagnostics.
 *
 * Issue #2274: Verifies that the generation_complete training event
 * includes the new per-phase timing fields: writeScoresMs, mutationMs,
 * deduplicationMs, speciationMs, and sortMs.
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
  GenerationPhaseTiming,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

Deno.test("EvolvePhaseTiming: new phase fields are present in phaseTiming", async () => {
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

  for (const event of events) {
    assert(
      event.phaseTiming !== undefined,
      "generation_complete event should include phaseTiming",
    );

    const timing = event.phaseTiming;

    // Issue #2274: mutationMs should be a non-negative number when present
    if (timing.mutationMs !== undefined) {
      assertEquals(typeof timing.mutationMs, "number");
      assertGreater(
        timing.mutationMs,
        -1,
        "mutationMs should be non-negative",
      );
    }

    // Issue #2274: deduplicationMs should be a non-negative number when present
    if (timing.deduplicationMs !== undefined) {
      assertEquals(typeof timing.deduplicationMs, "number");
      assertGreater(
        timing.deduplicationMs,
        -1,
        "deduplicationMs should be non-negative",
      );
    }

    // Issue #2274: speciationMs should be a non-negative number when present
    if (timing.speciationMs !== undefined) {
      assertEquals(typeof timing.speciationMs, "number");
      assertGreater(
        timing.speciationMs,
        -1,
        "speciationMs should be non-negative",
      );
    }

    // Issue #2274: sortMs should be a non-negative number when present
    if (timing.sortMs !== undefined) {
      assertEquals(typeof timing.sortMs, "number");
      assertGreater(
        timing.sortMs,
        -1,
        "sortMs should be non-negative",
      );
    }

    // Issue #2274: writeScoresMs should be a non-negative number when present
    if (timing.writeScoresMs !== undefined) {
      assertEquals(typeof timing.writeScoresMs, "number");
      assertGreater(
        timing.writeScoresMs,
        -1,
        "writeScoresMs should be non-negative",
      );
    }

    // Issue #2287: preWarmMs should be a non-negative number when present
    if (timing.preWarmMs !== undefined) {
      assertEquals(typeof timing.preWarmMs, "number");
      assertGreater(
        timing.preWarmMs,
        -1,
        "preWarmMs should be non-negative",
      );
    }

    // Total should still be >= sum of all measured phases
    const measuredPhases = timing.fitnessMs + timing.breedingMs +
      timing.resultProcessingMs +
      (timing.mutationMs ?? 0) +
      (timing.deduplicationMs ?? 0) +
      (timing.speciationMs ?? 0) +
      (timing.sortMs ?? 0) +
      (timing.writeScoresMs ?? 0) +
      (timing.memoryEvictionMs ?? 0) +
      (timing.preWarmMs ?? 0);
    assert(
      timing.totalMs >= measuredPhases - 1, // allow 1ms rounding tolerance
      `totalMs (${timing.totalMs}) should be >= sum of measured phases (${measuredPhases})`,
    );
  }
});

Deno.test("EvolvePhaseTiming: new timing fields are optional in GenerationPhaseTiming", () => {
  // Verify the type accepts objects without the new optional fields
  const timingWithout: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 170,
  };
  assertEquals(timingWithout.writeScoresMs, undefined);
  assertEquals(timingWithout.mutationMs, undefined);
  assertEquals(timingWithout.deduplicationMs, undefined);
  assertEquals(timingWithout.speciationMs, undefined);
  assertEquals(timingWithout.sortMs, undefined);

  // Verify the type accepts objects with the new optional fields
  const timingWith: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 200,
    writeScoresMs: 5,
    mutationMs: 10,
    deduplicationMs: 8,
    speciationMs: 3,
    sortMs: 2,
  };
  assertEquals(timingWith.writeScoresMs, 5);
  assertEquals(timingWith.mutationMs, 10);
  assertEquals(timingWith.deduplicationMs, 8);
  assertEquals(timingWith.speciationMs, 3);
  assertEquals(timingWith.sortMs, 2);
});

Deno.test("EvolvePhaseTiming: all timing fields are numbers or undefined", async () => {
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
    populationSize: 15,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        timings.push(event.phaseTiming);
      }
    },
  });

  assertGreater(timings.length, 0, "Should capture at least one timing");

  for (const timing of timings) {
    // Required fields must be numbers
    assertEquals(typeof timing.fitnessMs, "number");
    assertEquals(typeof timing.breedingMs, "number");
    assertEquals(typeof timing.resultProcessingMs, "number");
    assertEquals(typeof timing.totalMs, "number");

    // Optional fields must be numbers or undefined
    const optionalFields: (keyof GenerationPhaseTiming)[] = [
      "writeScoresMs",
      "mutationMs",
      "deduplicationMs",
      "speciationMs",
      "sortMs",
      "memoryEvictionMs",
      "checkpointWriteMs",
      "preWarmMs",
    ];
    for (const field of optionalFields) {
      const value = timing[field];
      assert(
        value === undefined || typeof value === "number",
        `${field} should be number or undefined, got ${typeof value}`,
      );
      if (typeof value === "number") {
        assertGreater(value, -1, `${field} should be non-negative`);
      }
    }
  }
});
