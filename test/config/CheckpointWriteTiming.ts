/**
 * Tests for checkpoint write timing in training telemetry.
 *
 * Issue #2251: Verifies that generation_complete events include
 * checkpointWriteMs in phaseTiming when checkpointEveryGeneration is enabled,
 * and that it is undefined when checkpoints are not active.
 */
import { assert, assertEquals } from "@std/assert";
import { emptyDirSync } from "@std/fs";
import { Creature } from "@creature";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

Deno.test("checkpointWriteMs present when checkpointEveryGeneration enabled", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);
  const dir = ".creatures-checkpoint-timing-test";
  emptyDirSync(dir);

  try {
    await creature.evolveDataSet(trainingSet, {
      iterations: 3,
      targetError: 0.001,
      populationSize: 5,
      threads: 1,
      creatureStore: dir,
      checkpointEveryGeneration: true,
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
      assert(
        timing.checkpointWriteMs !== undefined,
        "checkpointWriteMs should be present when checkpoints are enabled",
      );
      assertEquals(typeof timing.checkpointWriteMs, "number");
      assert(
        timing.checkpointWriteMs! >= 0,
        `checkpointWriteMs should be non-negative, got ${timing.checkpointWriteMs}`,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("checkpointWriteMs undefined when checkpointEveryGeneration disabled", async () => {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  await creature.evolveDataSet(trainingSet, {
    iterations: 3,
    targetError: 0.001,
    populationSize: 5,
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
    assertEquals(
      timing.checkpointWriteMs,
      undefined,
      "checkpointWriteMs should be undefined when checkpoints are not active",
    );
  }
});
