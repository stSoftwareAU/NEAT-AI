import { assert, assertRejects } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Creature } from "@creature";
import { Neat } from "@neat/Neat.ts";
import { evolve } from "@neat/NeatEvolution.ts";
import { HardDeadlineExceededError } from "@neat/HardDeadlineInterrupt.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * GRQ #4418: interrupting a stalled fitness phase is not enough — GRQ-26
 * logged "stalled in fitness; interrupting" for 2h 42m while the unit kept
 * running. Once the interrupt's grace elapses the generation must fail loud so
 * the unit dies inside its bound instead of outliving it by 16×.
 *
 * The grace is injected, so this test never waits on the production value.
 */

function createTestDataDir(): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      input: new Float32Array([0.5, 0.5]),
      output: new Float32Array([0.5]),
    });
  }
  return makeDataDir(records, 2000);
}

function makeRecordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (...args) => lines.push(args.join(" ")),
    info: (...args) => lines.push(args.join(" ")),
    warn: (...args) => lines.push(args.join(" ")),
    error: (...args) => lines.push(args.join(" ")),
  };
  return { logger, lines };
}

/** Wait until the evolve loop has entered the named phase (bounded). */
async function waitForPhase(neat: Neat, phase: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (neat.inFlightPhase === phase) return;
    // deno-lint-ignore no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`evolve never entered the ${phase} phase`);
}

Deno.test({
  name:
    "fitness stall: an interrupt the phase ignores fails the generation loud",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataDir = createTestDataDir();
    const workers = [new WorkerHandler(dataDir, "MSE", true)];
    const priorLogger = getLogger();
    const { logger } = makeRecordingLogger();
    setLogger(logger);

    try {
      const options: NeatOptions = {
        populationSize: 6,
        timeoutMinutes: 1,
        threads: 1,
        logger,
      };
      const neat = new Neat(2, 1, options, workers);
      await neat.populatePopulation(new Creature(2, 1, { layers: [] }));

      // The wedge: fitness never returns and never observes the abort.
      neat.fitness.calculate = () => new Promise<void>(() => {});
      neat.hardDeadlineInterruptGraceMS = 20;

      const evolving = evolve(neat);
      await waitForPhase(neat, "fitness");
      // Drive the watchdog with a clock past the hard deadline (#2888).
      const fired = neat.pollHardDeadlineWatchdog(neat.hardDeadlineTS + 1);
      assert(fired, "the watchdog must interrupt the stalled phase");

      const error = await assertRejects(
        () => evolving,
        HardDeadlineExceededError,
      );
      assert(
        error.message.includes("fitness"),
        `the failure must name the stalled phase, got: ${error.message}`,
      );
    } finally {
      setLogger(priorLogger);
      for (const worker of workers) {
        worker.terminate();
      }
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});
