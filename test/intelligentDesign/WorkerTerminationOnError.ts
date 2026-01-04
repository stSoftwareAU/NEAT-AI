/**
 * Regression coverage: ensure Intelligent Design workers are always terminated.
 *
 * Historically, worker termination happened only on the "happy path" at the end
 * of `scanForSquashImprovements()`. If a task rejected and that rejection bubbled
 * out during throttling (`Promise.race(...)`), the function would exit early and
 * leak worker threads.
 *
 * This test forces a deterministic failure after workers are created, then
 * asserts termination still occurs via a `try/finally` in the scan.
 */

import { assertEquals, assertRejects } from "@std/assert";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { scanForSquashImprovements } from "../../src/intelligentDesign/ImproveSquash.ts";

class FakeWorker {
  terminated = false;

  score(
    creature: Creature,
    uuid: string,
    _dataDir: string,
    // deno-lint-ignore no-explicit-any -- test double: not validating NeatOptions shape here
    _options: any,
  ) {
    return Promise.resolve({
      taskID: 1,
      duration: 0,
      score: {
        uuid,
        score: 1,
        creature: JSON.stringify(creature.exportJSON(), null, 1),
        error: 0,
      },
    });
  }

  terminate() {
    this.terminated = true;
  }
}

// Test creature with two hidden neurons so throttling is exercised on the 2nd.
const testCreatureJson: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    {
      type: "hidden",
      squash: "TANH",
      index: 2,
      bias: 0,
      uuid: "neuron-hidden-1",
    },
    {
      type: "hidden",
      squash: "TANH",
      index: 3,
      bias: 0,
      uuid: "neuron-hidden-2",
    },
    { type: "output", squash: "LOGISTIC", index: 4, bias: 0 },
  ],
  synapses: [
    { from: 0, to: 2, weight: 0.5 },
    { from: 1, to: 2, weight: 0.5 },
    { from: 2, to: 3, weight: 0.5 },
    { from: 3, to: 4, weight: 0.5 },
  ],
  input: 2,
  output: 1,
};

Deno.test("scanForSquashImprovements: terminates workers when throttling surfaces a task rejection", async () => {
  const creature = Creature.fromJSON(testCreatureJson).exportJSON();
  const workers: FakeWorker[] = [];

  // Fail after the first worker task starts, but delay the rejection so the
  // scan hits the throttling `Promise.race(...)` path before the task is removed
  // from the pending set.
  const writeText = () =>
    new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error("simulated write failure")), 0);
    });

  await assertRejects(
    () =>
      scanForSquashImprovements({
        creature,
        targetSquash: "GELU",
        outputDir: ".test-id-worker-termination",
        dataDir: ".",
        bestScore: 0,
        cpuCount: 1,
        maxPending: 1,
        maxImprovements: 12,
        createWorker: () => {
          const w = new FakeWorker();
          workers.push(w);
          return w;
        },
        writeText,
        // Keep alternative tasks out of the picture for determinism.
        alternativeSquashes: [],
      }),
    Error,
    "simulated write failure",
  );

  assertEquals(workers.length, 1);
  assertEquals(workers[0].terminated, true);
});
