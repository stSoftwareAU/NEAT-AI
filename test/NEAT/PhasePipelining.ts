/**
 * Tests for phase pipelining in the evolution loop (Issue #2314).
 *
 * Verifies that overlapping sequential main-thread phases with worker tasks
 * produces correct evolution results:
 *   1. Breeding overlapped with result processing + plateau/MCMC config
 *   2. Deduplication overlapped with WASM pre-warming
 *
 * These tests exercise real evolution to confirm that the pipelined ordering
 * does not introduce data races or generation correctness issues.
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
  GenerationPhaseTiming,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

Deno.test("PhasePipelining: evolution produces valid results with overlapped phases", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(trainingSet, {
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

  // Evolution should complete without errors
  assert(result, "Evolution should return a result");
  assert(result.score !== undefined, "Result should have a score");
  assert(Number.isFinite(result.score), "Score should be finite");

  // Should have run multiple generations
  assertGreater(
    events.length,
    0,
    "Should emit at least one generation_complete event",
  );

  // Each generation should have valid phase timing
  for (const event of events) {
    assert(event.phaseTiming, "Event should include phaseTiming");
    const timing = event.phaseTiming;

    // All phase durations should be non-negative
    assertGreater(timing.fitnessMs, -1, "fitnessMs should be non-negative");
    assertGreater(timing.breedingMs, -1, "breedingMs should be non-negative");
    assertGreater(
      timing.resultProcessingMs,
      -1,
      "resultProcessingMs should be non-negative",
    );
    assertGreater(timing.totalMs, 0, "totalMs should be positive");

    // Issue #2314: With overlapped phases, breedingMs includes time during
    // which result processing ran concurrently. Both are still individually
    // valid non-negative durations.
    if (timing.mutationMs !== undefined) {
      assertGreater(timing.mutationMs, -1, "mutationMs should be non-negative");
    }
    if (timing.deduplicationMs !== undefined) {
      assertGreater(
        timing.deduplicationMs,
        -1,
        "deduplicationMs should be non-negative",
      );
    }
    if (timing.preWarmMs !== undefined) {
      assertGreater(timing.preWarmMs, -1, "preWarmMs should be non-negative");
    }
  }
});

Deno.test("PhasePipelining: multi-threaded evolution correctness with pipelining", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.001,
    populationSize: 15,
    threads: 2,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  // Evolution should complete without errors even with multiple threads
  assert(result, "Multi-threaded evolution should return a result");
  assert(Number.isFinite(result.score), "Score should be finite");

  assertGreater(
    events.length,
    0,
    "Should emit at least one generation_complete event",
  );

  // Verify no NaN or Infinity in timing
  for (const event of events) {
    const timing = event.phaseTiming;
    assert(Number.isFinite(timing.totalMs), "totalMs should be finite");
    assert(Number.isFinite(timing.fitnessMs), "fitnessMs should be finite");
    assert(Number.isFinite(timing.breedingMs), "breedingMs should be finite");
  }
});

Deno.test("PhasePipelining: population maintains correct size after pipelined phases", async () => {
  const populationSize = 25;
  let lastPopulationSize = 0;

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.001,
    populationSize: populationSize,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        lastPopulationSize = event.populationSize;
      }
    },
  });

  // Population size should remain within expected bounds (may be slightly
  // under due to deduplication culling, but should not wildly deviate).
  assertGreater(
    lastPopulationSize,
    0,
    "Population should have at least one creature",
  );
  assert(
    lastPopulationSize <= populationSize + 5,
    `Population size (${lastPopulationSize}) should not greatly exceed configured size (${populationSize})`,
  );
});

Deno.test("PhasePipelining: pipelineOverlapMs reports overlap and maintains timing invariant", async () => {
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
    // pipelineOverlapMs should be a non-negative number or undefined
    if (timing.pipelineOverlapMs !== undefined) {
      assertEquals(typeof timing.pipelineOverlapMs, "number");
      assertGreater(
        timing.pipelineOverlapMs,
        -1,
        "pipelineOverlapMs should be non-negative",
      );
    }

    // Issue #2314: The timing invariant totalMs >= sum - overlap must hold.
    // With pipelining, individual phase sums can exceed totalMs by the
    // overlap amount (because overlapped phases double-count wall-clock time).
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

Deno.test("PhasePipelining: pipelineOverlapMs type is optional in GenerationPhaseTiming", () => {
  // Verify backward compatibility — the type accepts objects without pipelineOverlapMs
  const timingWithout: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 170,
  };
  assertEquals(timingWithout.pipelineOverlapMs, undefined);

  // Verify the type accepts objects with pipelineOverlapMs
  const timingWith: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 155,
    pipelineOverlapMs: 15,
  };
  assertEquals(timingWith.pipelineOverlapMs, 15);
});
