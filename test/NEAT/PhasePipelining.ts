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
import { assert, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
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
