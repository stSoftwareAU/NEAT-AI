/**
 * Regression coverage: `scanForSquashImprovements()` must write creature files
 * using the atomic safe write utilities.
 *
 * Historically this function used `Deno.writeTextFile()` / `Deno.writeTextFileSync()`
 * directly, which can leave partial/corrupted model files if interrupted mid-write.
 */

import { assertEquals } from "@std/assert";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import {
  scanForSquashImprovements,
} from "../../src/intelligentDesign/ImproveSquash.ts";
import type { ResponseData } from "../../src/intelligentDesign/workers/ResponseData.ts";

const testCreatureJson: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    {
      type: "hidden",
      squash: "TANH",
      index: 2,
      bias: 0,
      uuid: "neuron-hidden-atomic-1",
    },
    { type: "output", squash: "LOGISTIC", index: 3, bias: 0 },
  ],
  synapses: [
    { from: 0, to: 2, weight: 0.5 },
    { from: 1, to: 2, weight: 0.5 },
    { from: 2, to: 3, weight: 0.5 },
  ],
  input: 2,
  output: 1,
};

class FakeWorker {
  private call = 0;

  score(
    creature: Creature,
    uuid: string,
    _dataDir: string,
    _options: NeatOptions,
  ): Promise<ResponseData> {
    this.call++;
    const score = 1 + this.call; // 2 then 3
    const exported = creature.exportJSON();

    return Promise.resolve({
      taskID: this.call,
      duration: 0,
      score: {
        uuid,
        score,
        creature: JSON.stringify(exported, null, 1),
        error: 0,
      },
    });
  }

  terminate(): void {
    // No-op for tests.
  }
}

Deno.test("scanForSquashImprovements uses injected safe writers (async + sync paths)", async () => {
  const writesAsync: Array<{ path: string; content: string }> = [];
  const writesSync: Array<{ path: string; content: string }> = [];
  const removes: string[] = [];

  const worker = new FakeWorker();
  const creature = Creature.fromJSON(testCreatureJson).exportJSON();

  const result = await scanForSquashImprovements({
    creature,
    targetSquash: "GELU",
    outputDir: ".test-output",
    dataDir: ".test-data",
    bestScore: 1,
    maxImprovements: 1,
    timeoutMs: 10_000,
    cpuCount: 1,
    alternativeSquashes: ["Swish"],
    createWorker: () => worker,
    writeText: (path, content) => {
      writesAsync.push({ path, content });
      return Promise.resolve();
    },
    writeTextSync: (path, content) => {
      writesSync.push({ path, content });
    },
    remove: (path) => {
      removes.push(path);
      return Promise.resolve();
    },
  });

  assertEquals(writesAsync.length, 1);
  assertEquals(writesSync.length, 1);
  assertEquals(removes.length, 1);

  // Alternative improvement replaces the original best; the old path is removed.
  assertEquals(removes[0], writesAsync[0].path);

  // Final improvement path should be the alternative squash.
  const improvement = result.improvements.get("neuron-hidden-atomic-1");
  assertEquals(improvement?.path, writesSync[0].path);
});
