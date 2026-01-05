/**
 * Regression coverage: worker scoring failures must not be silently ignored.
 *
 * When workers return `ResponseData.error` (with `score` undefined), scans must:
 * - report failed attempts via `failed` / `errors`
 * - ensure `tested` counts only successful scoring operations
 *
 * This prevents misleading "tested: N" summaries when scoring could not run
 * (e.g. missing data directory, invalid data, or `scoreDir()` throwing).
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

  // Ensure we only scan a single neuron for deterministic counts.
  const first = hiddenNeurons[0];
  assertExists(first.uuid);
  for (const n of hiddenNeurons) {
    n.squash = "GELU";
  }
  first.squash = "TANH";

  return { exported, hiddenUUID: first.uuid };
}

Deno.test("scanForSquashImprovements surfaces worker errors and does not inflate tested count", async () => {
  const { exported, hiddenUUID } = makeSingleHiddenCreatureExport();

  const fakeWorker = {
    score(): Promise<ResponseData> {
      return Promise.resolve({
        taskID: 1,
        duration: 1,
        error: {
          name: "NotFound",
          message: "dataDir does not exist",
        },
      });
    },
    terminate() {
      // No-op for tests.
    },
  };

  const progress: Array<{ completed: number; total: number }> = [];

  const result = await scanForSquashImprovements({
    creature: exported,
    targetSquash: "GELU",
    outputDir: ".id-out",
    dataDir: ".missing-data-dir",
    bestScore: 1.0,
    cpuCount: 1,
    createWorker: () => fakeWorker,
    alternativeSquashes: [],
    writeText: () => Promise.resolve(),
    onProgress: (completed, total) => progress.push({ completed, total }),
  });

  assertEquals(result.timedOut, false);
  assertEquals(result.improved, 0);
  assertEquals(result.improvements.size, 0);

  // Critical assertions: one attempt failed, but zero successful scores.
  assertEquals(result.attempted, 1);
  assertEquals(result.failed, 1);
  assertEquals(result.tested, 0);

  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].uuid, hiddenUUID);
  assertEquals(result.errors[0].stage, "target");
  assertEquals(result.errors[0].message.includes("does not exist"), true);

  assertEquals(progress.length, 1);
  assertEquals(progress[0].completed, 1);
  assertEquals(progress[0].total, 1);
});
