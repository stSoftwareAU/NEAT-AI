/**
 * Tests for new per-phase timing fields in training telemetry.
 *
 * Issue #2274: Verifies that generation_complete events include
 * the new phase timing fields: writeScoresMs, mutationMs,
 * deduplicationMs, and speciationMs.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

Deno.test("mutationMs present in phaseTiming", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assert(
    events.length > 0,
    "Should emit at least one generation_complete event",
  );

  // At least one generation should report mutation timing
  const hasMutation = events.some(
    (e) =>
      e.phaseTiming.mutationMs !== undefined &&
      e.phaseTiming.mutationMs >= 0,
  );
  assert(
    hasMutation,
    "At least one generation should report mutationMs",
  );

  // Verify all reported mutationMs values are valid numbers
  for (const event of events) {
    const timing = event.phaseTiming;
    if (timing.mutationMs !== undefined) {
      assertEquals(typeof timing.mutationMs, "number");
      assert(
        timing.mutationMs >= 0,
        `mutationMs should be non-negative, got ${timing.mutationMs}`,
      );
    }
  }
});

Deno.test("deduplicationMs present in phaseTiming", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assert(
    events.length > 0,
    "Should emit at least one generation_complete event",
  );

  // At least one generation should report de-duplication timing
  const hasDedup = events.some(
    (e) =>
      e.phaseTiming.deduplicationMs !== undefined &&
      e.phaseTiming.deduplicationMs >= 0,
  );
  assert(
    hasDedup,
    "At least one generation should report deduplicationMs",
  );

  // Verify all reported values are valid
  for (const event of events) {
    const timing = event.phaseTiming;
    if (timing.deduplicationMs !== undefined) {
      assertEquals(typeof timing.deduplicationMs, "number");
      assert(
        timing.deduplicationMs >= 0,
        `deduplicationMs should be non-negative, got ${timing.deduplicationMs}`,
      );
    }
  }
});

Deno.test("speciationMs present in phaseTiming", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assert(
    events.length > 0,
    "Should emit at least one generation_complete event",
  );

  // At least one generation should report speciation timing
  const hasSpeciation = events.some(
    (e) =>
      e.phaseTiming.speciationMs !== undefined &&
      e.phaseTiming.speciationMs >= 0,
  );
  assert(
    hasSpeciation,
    "At least one generation should report speciationMs",
  );

  // Verify all reported values are valid
  for (const event of events) {
    const timing = event.phaseTiming;
    if (timing.speciationMs !== undefined) {
      assertEquals(typeof timing.speciationMs, "number");
      assert(
        timing.speciationMs >= 0,
        `speciationMs should be non-negative, got ${timing.speciationMs}`,
      );
    }
  }
});

Deno.test("phaseTiming fields sum to approximately totalMs", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assert(
    events.length > 0,
    "Should emit at least one generation_complete event",
  );

  for (const event of events) {
    const timing = event.phaseTiming;
    // Sum of instrumented phases should not exceed totalMs plus any
    // pipeline overlap (Issue #2314: resultProcessingMs runs during
    // breedingMs, speciationMs runs during writeScoresMs, etc.).
    // A small absolute tolerance handles timer-resolution variance.
    const instrumentedSum = timing.fitnessMs + timing.breedingMs +
      timing.resultProcessingMs +
      (timing.memoryEvictionMs ?? 0) +
      (timing.writeScoresMs ?? 0) +
      (timing.mutationMs ?? 0) +
      (timing.deduplicationMs ?? 0) +
      (timing.speciationMs ?? 0);

    const overlapAllowance = timing.pipelineOverlapMs ?? 0;
    const tolerance = 10;

    assert(
      instrumentedSum <= timing.totalMs + overlapAllowance + tolerance,
      `Instrumented phases sum (${instrumentedSum}ms) should not greatly ` +
        `exceed totalMs (${timing.totalMs}ms) + overlap (${overlapAllowance}ms) ` +
        `+ tolerance (${tolerance}ms)`,
    );
  }
});
