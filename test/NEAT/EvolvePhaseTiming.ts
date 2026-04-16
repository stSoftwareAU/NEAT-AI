/**
 * Tests for per-generation phase timing diagnostics.
 *
 * Issue #2239: Verifies that the generation_complete training event
 * includes per-phase timing data (phaseTiming) when evolution runs.
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

Deno.test("EvolvePhaseTiming: generation_complete includes phaseTiming data", async () => {
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

  // Every generation_complete event should include phaseTiming
  for (const event of events) {
    assert(
      event.phaseTiming !== undefined,
      "generation_complete event should include phaseTiming",
    );

    const timing = event.phaseTiming;

    // All phase durations should be non-negative numbers
    assertEquals(typeof timing.fitnessMs, "number");
    assertGreater(
      timing.fitnessMs,
      -1,
      "fitnessMs should be non-negative",
    );

    assertEquals(typeof timing.breedingMs, "number");
    assertGreater(
      timing.breedingMs,
      -1,
      "breedingMs should be non-negative",
    );

    assertEquals(typeof timing.resultProcessingMs, "number");
    assertGreater(
      timing.resultProcessingMs,
      -1,
      "resultProcessingMs should be non-negative",
    );

    assertEquals(typeof timing.totalMs, "number");
    assertGreater(
      timing.totalMs,
      -1,
      "totalMs should be non-negative",
    );

    // Issue #2314: With phase pipelining, breeding overlaps with result
    // processing, so the sum of individual phase durations can exceed
    // totalMs. Verify that totalMs is at least as large as the longest
    // single phase (a weaker but correct invariant).
    const longestPhase = Math.max(
      timing.fitnessMs,
      timing.breedingMs,
      timing.resultProcessingMs,
    );
    assert(
      timing.totalMs >= longestPhase - 1, // allow 1ms rounding tolerance
      `totalMs (${timing.totalMs}) should be >= longest phase (${longestPhase})`,
    );
  }
});
