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
    iterations: 50,
    targetError: 0.0001, // Very low target to encourage stagnation
    populationSize: 10,
    threads: 1,
    plateauDetection: {
      enabled: true,
      windowSize: 3,
      minImprovementRate: 0.001,
      rapidImprovementRate: 0.01,
      responseMutationMultiplier: 2.0,
    },
    onTrainingEvent: (event) => {
      events.push(event);
    },
  });

  const plateauEvents = events.filter((e) => e.kind === "plateau_detected");

  // With a high minImprovementRate and XOR, we should see plateau events
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
