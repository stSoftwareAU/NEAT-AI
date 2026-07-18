/**
 * Tests for structured training lifecycle event logging.
 *
 * Issue #1615: Verifies that the onTrainingEvent callback receives
 * correctly structured events during evolution.
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

Deno.test("TrainingEvent - generation_complete events are emitted", async () => {
  const events: TrainingEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event) => {
      events.push(event);
    },
  });

  // At least some generation_complete events should be emitted
  const generationEvents = events.filter(
    (e) => e.kind === "generation_complete",
  ) as GenerationCompleteEvent[];

  assertGreater(
    generationEvents.length,
    0,
    "Should emit at least one generation_complete event",
  );

  // Verify structure of the first generation_complete event
  const first = generationEvents[0];
  assertEquals(first.kind, "generation_complete");
  assertEquals(typeof first.timestamp, "string");
  assertGreater(first.generation, 0);
  assertEquals(typeof first.bestFitness, "number");
  assertEquals(typeof first.averageFitness, "number");
  assertGreater(first.populationSize, 0);
  // Issue #3402: population topology averages must be present and finite so a
  // memory-profile line can attribute heap growth to topology growth.
  assertEquals(typeof first.averageNeurons, "number");
  assertEquals(Number.isFinite(first.averageNeurons), true);
  assertEquals(typeof first.averageSynapses, "number");
  assertEquals(Number.isFinite(first.averageSynapses), true);
  // A 2-input/1-output creature always has at least one neuron and one synapse,
  // so the population averages must be strictly positive (not the 0 the GRQ-19
  // memprofile line reported).
  assertGreater(first.averageNeurons, 0);
  assertGreater(first.averageSynapses, 0);
  assertGreater(first.elapsedMs, -1);

  // Timestamp should be a valid ISO-8601 string
  const parsed = new Date(first.timestamp);
  assert(!isNaN(parsed.getTime()), "Timestamp should be valid ISO-8601");
});

Deno.test("TrainingEvent - averageFitness is finite when verbose is false (Issue #2753)", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    // verbose deliberately omitted (defaults to false) — the default code path.
    onTrainingEvent: (event) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assertGreater(events.length, 0, "Should emit generation_complete events");

  for (const event of events) {
    assert(
      Number.isFinite(event.averageFitness),
      `averageFitness must be finite, got ${event.averageFitness}`,
    );
  }
});

Deno.test("TrainingEvent - generation numbers are sequential", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assertGreater(events.length, 0);

  // Verify generation numbers are sequential starting from 1
  for (let i = 0; i < events.length; i++) {
    assertEquals(
      events[i].generation,
      i + 1,
      `Generation ${i} should have number ${i + 1}`,
    );
  }
});

Deno.test("TrainingEvent - no events when callback not provided", async () => {
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  // No onTrainingEvent callback — should work normally without errors
  const result = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 3,
    targetError: 0.1,
    populationSize: 10,
    threads: 1,
  });

  assertEquals(typeof result.error, "number");
  assertEquals(typeof result.score, "number");
});

Deno.test("TrainingEvent - callback exceptions do not disrupt training", async () => {
  let callCount = 0;

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  const result = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: () => {
      callCount++;
      throw new Error("Deliberate test error in callback");
    },
  });

  // Training should complete despite callback throwing
  assertEquals(typeof result.error, "number");
  assertGreater(callCount, 0, "Callback should have been invoked");
});

Deno.test("TrainingEvent - plateau_detected events emitted when plateau detected", async () => {
  const events: TrainingEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 100,
    targetError: 0.0001, // Very low target to encourage stagnation
    populationSize: 10,
    threads: 1,
    plateauDetection: {
      enabled: true,
      windowSize: 3,
      // High threshold: any window where improvement is < 50% triggers a plateau.
      // After the first few rapid iterations XOR improvement falls well below this,
      // ensuring plateau events are reliably emitted regardless of random seed.
      minImprovementRate: 0.5,
      rapidImprovementRate: 0.9,
      responseMutationMultiplier: 2.0,
    },
    onTrainingEvent: (event) => {
      events.push(event);
    },
  });

  const plateauEvents = events.filter((e) => e.kind === "plateau_detected");

  // With minImprovementRate=0.5 (50% per window), plateau is reliably triggered
  assertGreater(
    plateauEvents.length,
    0,
    "Should emit at least one plateau_detected event",
  );

  const first = plateauEvents[0];
  assertEquals(first.kind, "plateau_detected");
  assertEquals(typeof first.timestamp, "string");
  assert(
    "stagnationCount" in first && typeof first.stagnationCount === "number",
  );
  assert(
    "plateauThreshold" in first && typeof first.plateauThreshold === "number",
  );
  assert(
    "mutationMultiplier" in first &&
      typeof first.mutationMultiplier === "number",
  );
});

Deno.test("TrainingEvent - events include all required metadata fields", async () => {
  const events: TrainingEvent[] = [];

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
    onTrainingEvent: (event) => {
      events.push(event);
    },
  });

  // All events should have kind and timestamp
  for (const event of events) {
    assertEquals(typeof event.kind, "string");
    assertGreater(
      event.kind.length,
      0,
      "Event kind should be a non-empty string",
    );
    assertEquals(typeof event.timestamp, "string");
    const parsed = new Date(event.timestamp);
    assert(!isNaN(parsed.getTime()), "Timestamp should be valid ISO-8601");
  }
});

Deno.test("TrainingEvent - species_adjusted events are emitted", async () => {
  const events: TrainingEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations: 5,
    targetError: 0.001,
    populationSize: 20,
    threads: 1,
    onTrainingEvent: (event) => {
      events.push(event);
    },
  });

  const speciesEvents = events.filter((e) => e.kind === "species_adjusted");

  assertGreater(
    speciesEvents.length,
    0,
    "Should emit at least one species_adjusted event",
  );

  const first = speciesEvents[0];
  assertEquals(first.kind, "species_adjusted");
  assert(
    "speciesCount" in first && typeof first.speciesCount === "number",
  );
  assert(
    "compatibilityThreshold" in first &&
      typeof first.compatibilityThreshold === "number",
  );
});

Deno.test("TrainingEvent - timestamps are parseable by Temporal.Instant.from (Issue #2817)", async () => {
  const events: TrainingEvent[] = [];

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
    onTrainingEvent: (event) => {
      events.push(event);
    },
  });

  assertGreater(events.length, 0, "Should emit at least one training event");

  // Issue #2817: wall-clock timestamps emitted by CreatureTraining must be
  // produced by Temporal.Now.instant().toString() — i.e. native Temporal —
  // which means every timestamp must parse through Temporal.Instant.from
  // without throwing and produce an epoch after the 2020-01-01 cutoff (a
  // sanity check that we are emitting a real wall-clock instant, not a
  // zero/epoch placeholder).
  // Cutoff: 2020-01-01T00:00:00Z in epoch nanoseconds.
  const cutoffNs = Temporal.Instant.from("2020-01-01T00:00:00Z")
    .epochNanoseconds;
  for (const event of events) {
    const instant = Temporal.Instant.from(event.timestamp);
    assert(
      instant.epochNanoseconds > cutoffNs,
      `Event timestamp ${event.timestamp} should be after 2020-01-01`,
    );
  }
});

Deno.test(
  "TrainingEvent - NeatEvolution events use Temporal.Instant timestamps (Issue #2816)",
  async () => {
    const events: TrainingEvent[] = [];

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
      onTrainingEvent: (event) => {
        events.push(event);
      },
    });

    // The NeatEvolution loop emits species_adjusted events on every
    // generation; this is the canonical NeatEvolution.ts timestamp site
    // migrated in Issue #2816. Asserting on it guards against a future
    // regression to `new Date().toISOString()`.
    const speciesAdjusted = events.filter(
      (e) => e.kind === "species_adjusted",
    );
    assertGreater(
      speciesAdjusted.length,
      0,
      "Expected at least one species_adjusted event from NeatEvolution",
    );

    const cutoffNs = Temporal.Instant.from("2020-01-01T00:00:00Z")
      .epochNanoseconds;
    for (const event of speciesAdjusted) {
      // Must parse as a native Temporal.Instant — guards the migration
      // from `new Date().toISOString()` to `Temporal.Now.instant()`.
      const instant = Temporal.Instant.from(event.timestamp);
      assert(
        instant.epochNanoseconds > cutoffNs,
        `species_adjusted timestamp ${event.timestamp} should be after 2020-01-01`,
      );
    }
  },
);
