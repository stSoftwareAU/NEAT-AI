/**
 * Coverage tests for `scanForSquashImprovements()`.
 *
 * These tests use the built-in dependency injection hooks to avoid:
 * - spawning real workers
 * - writing to disk
 * - needing file-backed datasets
 *
 * We still exercise the task orchestration, improvement selection, alternative
 * squash exploration, and cleanup logic.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { scanForSquashImprovements } from "../../src/intelligentDesign/ImproveSquash.ts";
import type { ResponseData } from "../../src/intelligentDesign/workers/ResponseData.ts";

function makeDeterministicCreatureExport() {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exported = creature.exportJSON();
  const hidden = exported.neurons.find((n) => n.type === "hidden");
  assertExists(hidden?.uuid);
  // Ensure the hidden neuron starts as TANH so it will be scanned.
  hidden.squash = "TANH";
  return { exported, hiddenUUID: hidden.uuid };
}

Deno.test("scanForSquashImprovements records improvement then upgrades via alternative squash", async () => {
  const { exported, hiddenUUID } = makeDeterministicCreatureExport();

  const writes: Array<
    { path: string; content: string; mode: "async" | "sync" }
  > = [];
  const removes: string[] = [];
  const terminated: number[] = [];

  const fakeWorker = {
    score(creature: Creature, uuid: string): Promise<ResponseData> {
      const json = creature.exportJSON();
      const neuron = json.neurons.find((n) => n.uuid === uuid);
      const squash = neuron?.squash;

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
      terminated.push(1);
    },
  };

  const progress: Array<{ completed: number; total: number }> = [];

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
    writeText: (path, content) => {
      writes.push({ path, content, mode: "async" });
      return Promise.resolve();
    },
    writeTextSync: (path, content) => {
      writes.push({ path, content, mode: "sync" });
    },
    remove: (path) => {
      removes.push(path);
      return Promise.resolve();
    },
    onProgress: (completed, total) => progress.push({ completed, total }),
  });

  assertEquals(result.timedOut, false);
  assertEquals(result.tested, 2); // includes the alternative completion
  assertEquals(result.improved, 1);

  const best = result.improvements.get(hiddenUUID);
  assertExists(best);
  assertEquals(best.squash, "Swish");

  // Writes: first async for targetSquash, then sync for alternative squash.
  assertEquals(writes.length, 2);
  assertEquals(writes[0].mode, "async");
  assertEquals(writes[1].mode, "sync");
  assertEquals(removes.length, 1);

  // Progress callback is only invoked for primary tasks.
  assertEquals(progress.length, 1);
  assertEquals(progress[0].completed, 1);
  assertEquals(progress[0].total, 1);

  // Cleanup: worker is always terminated (even on success).
  assertEquals(terminated.length, 1);
});

Deno.test("scanForSquashImprovements terminates workers if a file write fails", async () => {
  const { exported } = makeDeterministicCreatureExport();

  let terminated = 0;
  const fakeWorker = {
    score(creature: Creature, uuid: string): Promise<ResponseData> {
      const json = creature.exportJSON();
      return Promise.resolve({
        taskID: 1,
        duration: 1,
        score: {
          uuid,
          score: 2.0,
          creature: JSON.stringify(json, null, 1),
          error: 0.01,
        },
      });
    },
    terminate() {
      terminated++;
    },
  };

  await assertRejects(
    () =>
      scanForSquashImprovements({
        creature: exported,
        targetSquash: "GELU",
        outputDir: ".id-out",
        dataDir: ".",
        bestScore: 1.0,
        cpuCount: 1,
        createWorker: () => fakeWorker,
        alternativeSquashes: [],
        writeText: () => Promise.reject(new Error("write failed")),
      }),
    Error,
    "write failed",
  );

  assertEquals(terminated, 1);
});

Deno.test("scanForSquashImprovements reports timedOut when task remains pending past deadline", async () => {
  const { exported } = makeDeterministicCreatureExport();

  let terminated = 0;
  const fakeWorker = {
    score(creature: Creature, uuid: string): Promise<ResponseData> {
      const json = creature.exportJSON();
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            taskID: 1,
            duration: 1,
            score: {
              uuid,
              score: 1.1,
              creature: JSON.stringify(json, null, 1),
              error: 0.01,
            },
          });
        }, 5);
      });
    },
    terminate() {
      terminated++;
    },
  };

  const result = await scanForSquashImprovements({
    creature: exported,
    targetSquash: "GELU",
    outputDir: ".id-out",
    dataDir: ".",
    bestScore: 1.0,
    cpuCount: 1,
    createWorker: () => fakeWorker,
    alternativeSquashes: [],
    timeoutMs: 1,
    writeText: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  });

  assertEquals(result.timedOut, true);
  assertEquals(terminated, 1);

  // Let any scheduled timers complete so `--trace-leaks` stays happy.
  await new Promise((resolve) => setTimeout(resolve, 10));
});
