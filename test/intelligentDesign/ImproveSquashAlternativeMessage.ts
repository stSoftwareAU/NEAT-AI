/**
 * Regression coverage: alternative squash improvements must report the correct
 * transformation in their message.
 *
 * The alternative candidate is evaluated starting from the already-upgraded
 * `targetSquash` creature (built from `res.score.creature`). The message must
 * therefore report `targetSquash -> altSquash` (not `originalSquash -> altSquash`).
 */

import { assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { scanForSquashImprovements } from "../../src/intelligentDesign/ImproveSquash.ts";
import type { ResponseData } from "../../src/intelligentDesign/workers/ResponseData.ts";

function makeSingleHiddenCreatureExport() {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exported = creature.exportJSON();
  const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length > 0, true);

  // Ensure we only scan a single neuron deterministically.
  const first = hiddenNeurons[0];
  assertExists(first.uuid);
  for (const n of hiddenNeurons) {
    n.squash = "GELU";
  }
  first.squash = "TANH";

  return { exported, hiddenUUID: first.uuid };
}

Deno.test("scanForSquashImprovements: alternative improvement message reports targetSquash -> altSquash", async () => {
  const { exported, hiddenUUID } = makeSingleHiddenCreatureExport();

  const fakeWorker = {
    score(creature: Creature, uuid: string): Promise<ResponseData> {
      const json = creature.exportJSON();
      const neuron = json.neurons.find((n) => n.uuid === uuid);
      const squash = neuron?.squash;

      // Ensure targetSquash is a mild improvement, and altSquash is the best.
      const score = squash === "Swish" ? 2.0 : squash === "GELU" ? 1.5 : 0.5;

      return Promise.resolve({
        taskID: 1,
        duration: 1,
        score: {
          uuid,
          score,
          creature: JSON.stringify(json, null, 1),
          error: 0.01,
        },
      });
    },
    terminate() {
      // No-op for tests.
    },
  };

  const result = await scanForSquashImprovements({
    creature: exported,
    targetSquash: "GELU",
    outputDir: ".id-out",
    dataDir: ".",
    bestScore: 1.0,
    epsilon: 1e-8,
    cpuCount: 1,
    createWorker: () => fakeWorker,
    alternativeSquashes: ["Swish"],
    writeText: () => Promise.resolve(),
    writeTextSync: () => {},
    remove: () => Promise.resolve(),
  });

  const best = result.improvements.get(hiddenUUID);
  assertExists(best);
  assertEquals(best.squash, "Swish");

  // Critical assertion: message should describe the step that was actually run.
  assertEquals(best.message.includes("GELU -> Swish"), true);
});
