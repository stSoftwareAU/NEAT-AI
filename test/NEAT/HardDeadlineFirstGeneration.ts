import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { shouldAbandonInFlight } from "@neat/HardDeadline.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * The first generation is never abandoned — Issue #3940.
 *
 * `shouldStopStartingGenerations` has always refused to stop a run that has not
 * completed a generation; the T+grace hard cap used to override that and hand
 * the caller a zero-generation result. The floor now lives in the one
 * chokepoint every enforcement path goes through
 * ({@link Neat.abandonInFlightPastHardDeadline}), so no caller can abandon
 * generation 1.
 *
 * Clocks are injected; nothing here measures elapsed time (#2888).
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

Deno.test("shouldAbandonInFlight: never fires before the first generation completes", () => {
  const deadline = 1_000_000;
  // Well past the cap, but nothing has been banked yet.
  assertEquals(shouldAbandonInFlight(0, deadline, deadline + 60_000), false);
  // Same clock, one generation in hand.
  assertEquals(shouldAbandonInFlight(1, deadline, deadline + 1), true);
});

Deno.test("shouldAbandonInFlight: unchanged once a generation is in hand", () => {
  const deadline = 1_000_000;
  // Before the cap: no abandon regardless of how many generations completed.
  assertEquals(shouldAbandonInFlight(5, deadline, deadline - 1), false);
  // Exactly on the cap is not past it.
  assertEquals(shouldAbandonInFlight(5, deadline, deadline), false);
  // No cap configured.
  assertEquals(shouldAbandonInFlight(5, 0, Number.MAX_SAFE_INTEGER), false);
});

Deno.test("abandonInFlightPastHardDeadline: refuses while no generation has completed", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.discoveryInProgress.set("stuck-disc", new Promise(() => {}));
    neat.trainingInProgress.set("stuck-train", new Promise(() => {}));
    const epochBefore = neat.abandonEpoch;

    // Cap long past, but generation 1 is still in flight.
    const broke = neat.abandonInFlightPastHardDeadline(Date.now() - 1000);

    assertEquals(
      broke,
      false,
      "the cap must not fire before one generation is banked",
    );
    assertEquals(
      neat.discoveryInProgress.size,
      1,
      "discovery bookkeeping must survive the first generation",
    );
    assertEquals(
      neat.trainingInProgress.size,
      1,
      "training bookkeeping must survive the first generation",
    );
    assertEquals(
      neat.terminationReason,
      undefined,
      "no termination reason may be recorded for a run with nothing banked",
    );
    assertEquals(
      neat.doNotStartMore,
      false,
      "the run must still be allowed to finish its first generation",
    );
    assertEquals(
      neat.abandonEpoch,
      epochBefore,
      "the abandon token must not move when nothing was abandoned",
    );

    // One generation in hand: #2892 / #2896 behaviour resumes unchanged.
    neat.generationsCompleted = 1;
    assert(
      neat.abandonInFlightPastHardDeadline(Date.now() - 1000),
      "the cap must fire once a generation has completed",
    );
    assertEquals(neat.discoveryInProgress.size, 0);
    assertEquals(neat.trainingInProgress.size, 0);
    assertEquals(neat.terminationReason, "hard-deadline");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("hard-deadline watchdog: does not interrupt fitness during the first generation", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10, timeoutMinutes: 1 };
    const neat = new Neat(2, 1, options, workers);

    const signal = neat.enterInFlightPhase("fitness");

    const broke = neat.pollHardDeadlineWatchdog(neat.hardDeadlineTS + 60_000);

    assertEquals(
      broke,
      false,
      "the watchdog must not fire while the first generation is scoring",
    );
    assertEquals(
      signal.aborted,
      false,
      "the first generation's fitness phase must not be interrupted",
    );

    // Once a generation is banked the watchdog behaves exactly as before.
    neat.generationsCompleted = 1;
    assert(neat.pollHardDeadlineWatchdog(neat.hardDeadlineTS + 60_000));
    assert(signal.aborted, "a stall after the first generation is interrupted");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("abandonWedgedFirstGeneration: interrupts a stalled phase and names an empty in-flight set (Issue #4053)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  const originalLogger = getLogger();
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  const recordingLogger: Logger = {
    debug: record,
    info: record,
    warn: record,
    error: record,
  };

  try {
    const options: NeatOptions = { populationSize: 10, timeoutMinutes: 5 };
    const neat = new Neat(2, 1, options, workers);
    // Installed after construction: the Neat constructor resets the global logger.
    setLogger(recordingLogger);

    const signal = neat.enterInFlightPhase("fitness");
    const epochBefore = neat.abandonEpoch;

    neat.abandonWedgedFirstGeneration(125_000);

    assert(signal.aborted, "the stalled phase must be interrupted");
    assertEquals(neat.terminationReason, "first-generation-wedged");
    assertEquals(neat.doNotStartMore, true);
    assertEquals(neat.abandonEpoch, epochBefore + 1);

    const log = lines.join("\n");
    assert(log.includes("First generation wedged after 125s"), log);
    assert(log.includes("stalled in fitness"), log);
    assert(log.includes("in-flight: none"), log);
  } finally {
    setLogger(originalLogger);
    await terminateWorkers(workers);
  }
});
