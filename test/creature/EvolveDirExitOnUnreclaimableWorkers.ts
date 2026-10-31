import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #4126: `exitOnUnreclaimableWorkers` reaches the `evolveDir` teardown.
 *
 * A worker that cannot be stopped is injected at the seam the teardown sees (a
 * handler that reports `couldNotBeStopped()`), the run is put past its hard cap
 * with an injected past `startTimeMS`, and the exit guard is a recording fake,
 * so nothing real exits and nothing waits on a timer.
 */

const GRACE_MS = 1234;
/** A fixed wall-clock reading, so the run's deadlines do not depend on the real clock. */
const NOW_MS = Date.UTC(2026, 0, 1);

function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

async function runWithWedgedWorker(
  exitOnUnreclaimableWorkers: boolean | undefined,
): Promise<{ scheduledMS: number[]; exitCodes: number[] }> {
  await initWasmForTests();

  const dataSetDir = makeDataDir(tinyDataSet(), 2000);
  const scheduledMS: number[] = [];
  const exitCodes: number[] = [];
  let armed: (() => void) | undefined;

  const deps: EvolveDirDeps = {
    // Past the hard cap (start + 2 min), inside the first-generation bound
    // (start + 6 min): the loop breaks on the hard-cap branch.
    startTimeMS: NOW_MS - 3 * 60_000,
    now: () => NOW_MS,
    teardownBudgetMS: 1,
    exitGuard: {
      graceMS: GRACE_MS,
      exit: (code) => {
        exitCodes.push(code);
      },
      schedule: (fn, ms) => {
        scheduledMS.push(ms);
        armed = fn;
      },
    },
    onNeatReady: (neat) => {
      neat.trainingInProgress.set("stuck-train", new Promise<void>(() => {}));
      for (const worker of neat.workers) {
        worker.terminate = () => {};
        worker.couldNotBeStopped = () => true;
      }
    },
  };

  try {
    await evolveDir(
      new Creature(2, 1, { layers: [{ count: 3 }] }),
      dataSetDir,
      {
        populationSize: 10,
        iterations: 1,
        timeoutMinutes: 1,
        threads: 1,
        exitOnUnreclaimableWorkers,
      },
      deps,
    );
  } finally {
    await Deno.remove(dataSetDir, { recursive: true });
  }

  armed?.();
  return { scheduledMS, exitCodes };
}

Deno.test({
  name:
    "evolveDir arms the exit guard when exitOnUnreclaimableWorkers is true and a worker could not be stopped (Issue #4126)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { scheduledMS, exitCodes } = await runWithWedgedWorker(true);

    assertEquals(scheduledMS, [GRACE_MS], "the guard is armed once");
    assertEquals(exitCodes.length, 1, "the armed guard exits when it fires");
  },
});

Deno.test({
  name:
    "evolveDir arms nothing when exitOnUnreclaimableWorkers is left at its default (Issue #4126)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { scheduledMS, exitCodes } = await runWithWedgedWorker(undefined);

    assert(scheduledMS.length === 0, "no exit may be armed unasked");
    assertEquals(exitCodes, []);
  },
});

Deno.test({
  name:
    "evolveDir reports and arms the exit guard after a failure with an unreclaimable worker",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();
    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const scheduledMS: number[] = [];
    const warnings: string[] = [];
    const previous = getLogger();
    const logger = {
      ...previous,
      warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
    };
    try {
      await assertRejects(
        () =>
          evolveDir(
            new Creature(2, 1, { layers: [{ count: 3 }] }),
            dataSetDir,
            {
              populationSize: 10,
              iterations: 1,
              threads: 1,
              exitOnUnreclaimableWorkers: true,
              logger,
            },
            {
              exitGuard: {
                graceMS: GRACE_MS,
                schedule: (_fn, ms) => scheduledMS.push(ms),
              },
              onNeatReady: (neat) => {
                for (const worker of neat.workers) {
                  worker.terminate = () => {};
                  worker.couldNotBeStopped = () => true;
                }
                throw new Error("run failed");
              },
            },
          ),
        Error,
        "run failed",
      );
      assertEquals(scheduledMS, [GRACE_MS]);
      assert(
        warnings.some((line) =>
          line.includes("teardown: 1 worker(s) could not be stopped")
        ),
      );
    } finally {
      setLogger(previous);
      await Deno.remove(dataSetDir, { recursive: true });
    }
  },
});
