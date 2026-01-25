/**
 * Tests for Intelligent Design worker processor.
 *
 * These tests stub `Creature.scoreDir()` to avoid dependence on file-backed
 * datasets while still exercising the worker scoring flow.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { WorkerProcessor } from "../../src/intelligentDesign/workers/WorkerProcessor.ts";
import type { RequestData } from "../../src/intelligentDesign/workers/WorkerHandler.ts";

Deno.test("WorkerProcessor.process returns score payload and tags exported creature", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  try {
    Creature.prototype.scoreDir = function () {
      return { score: 123.456, error: 0.789 } as const;
    };

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const exported = creature.exportJSON();
    const hidden = exported.neurons.find((n) => n.type === "hidden");
    assertExists(hidden?.uuid);

    const request: RequestData = {
      taskID: 42,
      score: {
        uuid: hidden.uuid,
        creature: JSON.stringify(exported, null, 1),
        dataDir: ".",
        options: {},
      },
    };

    const processor = new WorkerProcessor();
    const response = await processor.process(request);

    assertEquals(response.taskID, 42);
    assertExists(response.score);
    assertEquals(response.score.uuid, hidden.uuid);
    assertEquals(response.score.score, 123.456);
    assertEquals(response.score.error, 0.789);

    const scoredCreature = JSON.parse(response.score.creature);
    const scoreTag = scoredCreature.tags?.find((t: { name: string }) =>
      t.name === "score"
    );
    const errorTag = scoredCreature.tags?.find((t: { name: string }) =>
      t.name === "error"
    );
    assertExists(scoreTag);
    assertExists(errorTag);
    assertEquals(scoreTag.value, "123.456");
    assertEquals(errorTag.value, "0.789");
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
  }
});

Deno.test("WorkerProcessor.process throws on unknown message", async () => {
  const processor = new WorkerProcessor();

  await assertRejects(
    () => processor.process({ taskID: 1 } as RequestData),
    Error,
    "unknown message",
  );
});
