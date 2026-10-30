/**
 * Issue #4099: every scheduled training task logs a `scheduled` line whatever
 * `verbose` says, and the line says when the worker was borrowed from the fast
 * pool, so a scheduled-vs-terminal count over a log matches in a default run.
 */
import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Creature } from "@creature";
import type { Neat } from "@neat/Neat.ts";
import { scheduleTraining } from "@neat/NeatScheduling.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

const worker = {
  trainTracked: () => ({
    taskID: 1,
    response: new Promise<never>(() => {}), // never settles
  }),
};

/** `heavyIdle` false leaves the heavy pool empty so the fast pool is borrowed. */
function stubNeat(heavyIdle: boolean): Neat {
  const heavy = {
    selectWorker: () => heavyIdle ? worker : undefined,
    getIdleWorkers: () => [],
  };
  const fast = {
    selectWorker: () => undefined,
    getIdleWorkers: () => [worker],
  };
  return {
    config: createNeatConfig({ verbose: false, allowPoolBorrowing: true }),
    hardDeadlineTS: 0,
    abandonEpoch: 0,
    trainingInProgress: new Map(),
    trainingDeadlines: new Map(),
    trainingTasks: new Map(),
    alreadyScheduledMap: new Map<string, number>(),
    trainingRegressionTracker: new TrainingRegressionTracker(),
    heavyWorkerPool: heavy,
    fastWorkerPool: fast,
    isRunAbandonedSince: () => false,
    recordTrainingComplete: () => {},
  } as unknown as Neat;
}

async function scheduledLines(heavyIdle: boolean): Promise<string[]> {
  await initWasmForTests();
  const lines: string[] = [];
  const original = getLogger();
  const record = (...a: unknown[]) => lines.push(a.join(" "));
  const recording: Logger = {
    debug: () => {},
    info: record,
    warn: () => {},
    error: () => {},
  };
  // Built first: `createNeatConfig` resets the global logger.
  const neat = stubNeat(heavyIdle);
  const creature = new Creature(2, 1);
  setLogger(recording);
  try {
    scheduleTraining(neat, creature, 5);
  } finally {
    setLogger(original);
  }
  return lines.filter((l) => l.includes("scheduled"));
}

Deno.test("scheduleTraining logs `scheduled` with verbose off", async () => {
  const lines = await scheduledLines(true);
  assertEquals(lines.length, 1);
  assert(!lines[0].includes("borrowed"), lines[0]);
});

Deno.test("scheduleTraining names a worker borrowed from the fast pool", async () => {
  const lines = await scheduledLines(false);
  assertEquals(lines.length, 1);
  assert(lines[0].includes("(borrowed from fast pool)"), lines[0]);
});
