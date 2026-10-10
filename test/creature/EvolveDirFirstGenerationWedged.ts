import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { computeFirstGenerationDeadlineTS } from "@neat/HardDeadline.ts";
import type { TrainingTaskHandle } from "@neat/TrainingTaskHandle.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #4053: a first generation that never settles must end at its own
 * bound, not hang until an external watchdog kills the process.
 *
 * On the GRQ-21 sampler (5-minute `--timeout`) generation 1 never completed.
 * `evolveDir` awaited it with no deadline at all, so the run sat silent for
 * ~2 h until the external watchdog fired. Generation 1 is now bounded by
 * `computeFirstGenerationDeadlineTS`; on breach `Neat` cancels the in-flight
 * training tasks, logs which tasks were stuck, and `evolveDir` returns with
 * `terminationReason: "first-generation-wedged"`.
 *
 * Driven by an injected clock (#2888): the stubbed `evolve` never settles and
 * moves the clock past the first-generation bound, so the test makes no
 * elapsed-time assertions.
 */

/** Minimal 2-in / 1-out dataset; the model never needs to converge here. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

function makeRecordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  const logger: Logger = {
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  return { logger, lines };
}

/**
 * Fail loudly instead of hanging the suite: a regression here wedges
 * `evolveDir` forever, and a wedged worker is exactly the fault under test.
 */
function withRealTimeGuard<T>(
  work: Promise<T>,
  label: string,
  timeoutMS = 20_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: evolveDir did not return`)),
      timeoutMS,
    );
  });
  return Promise.race([work, guard]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}

const TIMEOUT_MINUTES = 5;

Deno.test({
  name:
    "evolveDir: a first generation that never settles ends at the first-generation bound",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4053-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const startMS = Date.now();
    const firstGenerationDeadlineMS = computeFirstGenerationDeadlineTS(
      startMS,
      TIMEOUT_MINUTES,
    )!;
    let nowMS = startMS;

    const cancelCalls: Array<{ taskID: number; reason: string }> = [];
    let quarantineCalls = 0;
    const fakeWorker = {
      cancelTask(taskID: number, reason: string): boolean {
        cancelCalls.push({ taskID, reason });
        return true;
      },
      quarantine(): void {
        quarantineCalls++;
      },
    };

    let captured: Neat | undefined;
    let evolveCalls = 0;

    const { logger, lines } = makeRecordingLogger();
    const options: NeatOptions = {
      populationSize: 6,
      iterations: 500,
      timeoutMinutes: TIMEOUT_MINUTES,
      threads: 1,
      creatureStore,
      logger,
    };

    const deps: EvolveDirDeps = {
      startTimeMS: startMS,
      now: () => nowMS,
      teardownBudgetMS: 1_000,
      onNeatReady: (neat) => {
        captured = neat;
        neat.trainingInProgress.set(
          "stuck-training-0c7db7ab",
          new Promise<void>(() => {}),
        );
        neat.trainingTasks.set(
          "stuck-training-0c7db7ab",
          { worker: fakeWorker, taskID: 42 } as unknown as TrainingTaskHandle,
        );
        neat.evolve = () => {
          evolveCalls++;
          nowMS = firstGenerationDeadlineMS + 60_000;
          return new Promise<never>(() => {});
        };
      },
    };

    const priorLogger = getLogger();
    try {
      const result = await withRealTimeGuard(
        evolveDir(creature, dataSetDir, options, deps),
        "never-settling first generation",
      );

      assert(
        nowMS > firstGenerationDeadlineMS,
        "injected clock must be past the first-generation bound",
      );
      assertEquals(result.terminationReason, "first-generation-wedged");
      assertEquals(result.generation, 0);
      assertEquals(evolveCalls, 1, "generation 1 must be entered exactly once");

      assert(captured, "onNeatReady must have handed back the Neat instance");
      assertEquals(captured.trainingInProgress.size, 0);
      assertEquals(captured.discoveryInProgress.size, 0);

      assertEquals(cancelCalls.length, 1, "the stuck task must be cancelled");
      assertEquals(cancelCalls[0].taskID, 42);
      assertEquals(
        quarantineCalls,
        0,
        "cancelling a wedged task must not quarantine the worker",
      );

      const joined = lines.join("\n");
      assert(
        joined.includes("First generation wedged after"),
        "the abandon must be logged when it happens",
      );
      assert(
        joined.includes("0c7db7ab"),
        "the log must name the in-flight task",
      );
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
