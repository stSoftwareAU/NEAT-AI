import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/**
 * Fitness-stall watchdog (GRQ #4141): a stall *inside* fitness must be
 * reported by name while it is happening and interrupted. An
 * `abandoning 0 in-flight task(s)` line after the fact is an explicit
 * failure — that is the GRQ-26 signature.
 *
 * Clock and the in-flight phase are injected; no elapsed-time measurement
 * (#2888).
 */

function createTestDataDir(input: number, output: number): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      input: new Float32Array(Array.from({ length: input }, () => 0.5)),
      output: new Float32Array(Array.from({ length: output }, () => 0.5)),
    });
  }
  return makeDataDir(records, 2000);
}

function createTestWorkers(dataDir: string): WorkerHandler[] {
  return [new WorkerHandler(dataDir, "MSE", true)];
}

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
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

Deno.test("fitness stall watchdog: reports the stalled phase by name while interrupting it", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  const priorLogger = getLogger();
  const { logger, lines } = makeRecordingLogger();
  setLogger(logger);

  try {
    const options: NeatOptions = {
      populationSize: 10,
      timeoutMinutes: 1,
      logger,
    };
    const neat = new Neat(2, 1, options, workers);

    const signal = neat.enterInFlightPhase("fitness");
    let interruptedWhileStalling = false;
    const stall = new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        interruptedWhileStalling = true;
        resolve();
      });
    });

    // Deadline already in the past; the stall is still in flight.
    const hardDeadlineMS = 1_000_000_000_000;
    const nowTS = hardDeadlineMS + 1;
    const broke = neat.abandonInFlightPastHardDeadline(hardDeadlineMS, nowTS);

    assert(broke, "watchdog must fire once the hard deadline has passed");
    await stall;
    assert(
      interruptedWhileStalling,
      "the stall must be interrupted while it is still in progress",
    );
    assert(signal.aborted, "the in-fitness abort signal must be raised");
    assertEquals(
      neat.inFlightPhase,
      "fitness",
      "phase stays named until leave",
    );

    const joined = lines.join("\n");
    assert(
      joined.includes("stalled in fitness"),
      `watchdog must name the stalled phase while it is happening, got: ${joined}`,
    );
    assert(
      !joined.includes("abandoning 0 in-flight task(s)"),
      "abandoning 0 in-flight task(s) after the fact is a failure",
    );
  } finally {
    setLogger(priorLogger);
    await terminateWorkers(workers);
  }
});

Deno.test("fitness stall watchdog: pollHardDeadlineWatchdog uses the instance hard deadline", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  const priorLogger = getLogger();
  const { logger, lines } = makeRecordingLogger();
  setLogger(logger);

  try {
    const options: NeatOptions = {
      populationSize: 10,
      timeoutMinutes: 1,
      logger,
    };
    const neat = new Neat(2, 1, options, workers);

    const signal = neat.enterInFlightPhase("fitness");
    const stall = new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve());
    });

    // Instance hardDeadlineTS is start + 1m + 1m grace. A now well past that
    // must interrupt the named fitness phase.
    const broke = neat.pollHardDeadlineWatchdog(neat.hardDeadlineTS + 1);

    assert(broke);
    await stall;
    const joined = lines.join("\n");
    assert(joined.includes("stalled in fitness"));
    assert(
      !joined.includes("abandoning 0 in-flight task(s)"),
      "abandoning 0 in-flight task(s) after the fact is a failure",
    );
  } finally {
    setLogger(priorLogger);
    await terminateWorkers(workers);
  }
});
