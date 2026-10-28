import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { processCompletedResults } from "@neat/ProcessCompletedResults.ts";
import {
  type ResponseData,
  WorkerHandler,
} from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/**
 * Unit tests for Neat.finishUp method.
 *
 * Issue #1397: Verify the finish-up logic that controls when
 * evolution should stop, including handling of in-progress discovery
 * and training, clean-up delays, and additional generation counts.
 *
 * Issue #1749: Additional coverage for discovery/training in-progress
 * scenarios, cleanup delays, and timeout calculations.
 */

function createTestDataDir(input: number, output: number): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      input: new Float32Array(
        Array.from({ length: input }, () => Math.random()),
      ),
      output: new Float32Array(
        Array.from({ length: output }, () => Math.random()),
      ),
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

Deno.test("finishUp: returns true when no in-progress work and no delays", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    // First call sets doNotStartMore=true
    // With no in-progress work, should return true
    const result = neat.finishUp();

    assertEquals(result, true, "Should return true when nothing in progress");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: returns true on multiple calls with no in-progress work", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    // Multiple calls should all return true
    const result1 = neat.finishUp();
    const result2 = neat.finishUp();
    const result3 = neat.finishUp();

    assertEquals(result1, true);
    assertEquals(result2, true);
    assertEquals(result3, true);
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Issue #1749: Discovery and Training In-Progress
// ============================================================================

Deno.test("finishUp: returns false when training is in progress", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate training in progress
    neat.trainingInProgress.set("train-uuid", Promise.resolve());

    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should return false when training in progress",
    );
    assertEquals(neat.doNotStartMore, true, "doNotStartMore should be set");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: returns false when discovery is in progress", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate discovery in progress
    neat.discoveryInProgress.set("disc-uuid", Promise.resolve());

    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should return false when discovery in progress",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: discovery timeout clears stuck discoveries", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate discovery in progress
    neat.discoveryInProgress.set("stuck-uuid", Promise.resolve());

    // Call finishUp repeatedly with iterations=4 to set max wait to 2
    let cleared = false;
    for (let i = 0; i < 10; i++) {
      const result = neat.finishUp(4);
      if (neat.discoveryInProgress.size === 0 || result === true) {
        cleared = true;
        break;
      }
    }

    assert(cleared, "Discovery should be cleared after timeout generations");
    assertEquals(
      neat.discoveryInProgress.size,
      0,
      "Discovery map should be empty after timeout",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Issue #2871: Training is an optional/best-effort phase and must NEVER be
// able to wedge the run. A training task whose worker promise never settles
// (e.g. a timed-out per-creature CPU score) must be abandoned after a bounded
// wait so the run can finalize and check in the best-so-far creature.
// ============================================================================

Deno.test("finishUp: training timeout clears stuck trainings", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // A training promise that never settles (mimics an orphaned timed-out
    // worker task that never resolves nor rejects).
    neat.trainingInProgress.set("stuck-train-uuid", new Promise(() => {}));

    // Call finishUp repeatedly with iterations=4 to bound the wait at 2.
    let cleared = false;
    for (let i = 0; i < 10; i++) {
      const result = neat.finishUp(4);
      if (neat.trainingInProgress.size === 0 || result === true) {
        cleared = true;
        break;
      }
    }

    assert(cleared, "Training should be cleared after timeout generations");
    assertEquals(
      neat.trainingInProgress.size,
      0,
      "Training map should be empty after timeout",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: clears stuck trainings promptly when wall-clock deadline has passed", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate a stuck (never-settling) training task.
    neat.trainingInProgress.set("expired-train-uuid", new Promise(() => {}));

    // Wall-clock deadline already in the past (caller's --timeout exceeded).
    const start = Date.now() - 10 * 60_000; // ran for 10 minutes
    const endTimeMS = Date.now() - 60_000; // 1 minute past deadline
    const iterations = 1000; // generous cap — must NOT keep the run alive
    const currentGeneration = 5;

    let cleared = false;
    for (let i = 0; i < 5; i++) {
      neat.finishUp(iterations, endTimeMS, start, currentGeneration);
      if (neat.trainingInProgress.size === 0) {
        cleared = true;
        break;
      }
    }
    assert(
      cleared,
      "Stuck training should be cleared within a few generations after the wall-clock deadline expires",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Issue #3166: cooperative-return grace before force-abandon
// ============================================================================

Deno.test("finishUp: grants a grace cycle so a cooperatively-returning training task is not force-abandoned", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // A task whose worker has just hit its own per-task timeout and returned:
    // still in the map (its result handler has not run yet) but NOT stuck (its
    // per-task deadline is in the future, so the watchdog leaves it alone).
    neat.trainingInProgress.set("returning-uuid", new Promise(() => {}));
    neat.trainingDeadlines.set("returning-uuid", Date.now() + 120_000);

    const start = Date.now() - 10 * 60_000;
    const endTimeMS = Date.now() - 60_000; // wall-clock deadline already passed
    const iterations = 1000;
    const currentGeneration = 5;

    // First cycle after the deadline: grace granted, task NOT abandoned.
    const first = neat.finishUp(
      iterations,
      endTimeMS,
      start,
      currentGeneration,
    );
    assertEquals(first, false, "Grace cycle keeps the finish-up loop alive");
    assertEquals(
      neat.trainingInProgress.size,
      1,
      "Task must survive the first cycle (bounded grace, not force-abandon)",
    );

    // Simulate the cooperative return: the worker result handler removes the
    // task during the grace window (as scheduleTraining's .then does).
    neat.trainingInProgress.delete("returning-uuid");
    neat.trainingDeadlines.delete("returning-uuid");

    // Next cycle sees no in-flight training and never force-abandons it.
    let finalized = false;
    for (let i = 0; i < 5; i++) {
      if (neat.finishUp(iterations, endTimeMS, start, currentGeneration)) {
        finalized = true;
        break;
      }
    }
    assert(
      finalized,
      "Run finalizes cleanly once the task returns cooperatively",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: still force-abandons a genuinely stuck training task within a bounded window", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // A genuinely stuck task that never settles and never removes itself.
    neat.trainingInProgress.set("stuck-uuid", new Promise(() => {}));
    neat.trainingDeadlines.set("stuck-uuid", Date.now() + 120_000);

    const start = Date.now() - 10 * 60_000;
    const endTimeMS = Date.now() - 60_000; // wall-clock deadline already passed
    const iterations = 1000;
    const currentGeneration = 5;

    let cleared = false;
    for (let i = 0; i < 5; i++) {
      neat.finishUp(iterations, endTimeMS, start, currentGeneration);
      if (neat.trainingInProgress.size === 0) {
        cleared = true;
        break;
      }
    }
    assert(
      cleared,
      "A stuck task is still force-abandoned within a bounded number of cycles",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: eventually finalizes despite a never-settling training task", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Orphaned training promise that will never settle.
    neat.trainingInProgress.set("never-settles", new Promise(() => {}));

    // Drive the finish-up loop with a bounded iteration cap. It must reach a
    // terminal `true` (finalize + checkin) rather than spinning forever.
    let finalized = false;
    for (let i = 0; i < 50; i++) {
      if (neat.finishUp(4)) {
        finalized = true;
        break;
      }
    }

    assert(
      finalized,
      "Run must finalize even when a training task never settles",
    );
    assertEquals(
      neat.trainingInProgress.size,
      0,
      "Stuck training must be abandoned before finalizing",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: returns false when additionalGenerationCount > 0", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.additionalGenerationCount = 5;

    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should return false when additional generations remain",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Issue #2432: Wall-clock takes precedence over generation-count fallback
// ============================================================================

Deno.test("finishUp: clears stuck discoveries promptly when wall-clock deadline has passed", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate a stuck discovery
    neat.discoveryInProgress.set("expired-uuid", new Promise(() => {}));

    // Wall-clock deadline already in the past (caller's --timeout exceeded)
    const start = Date.now() - 10 * 60_000; // ran for 10 minutes
    const endTimeMS = Date.now() - 60_000; // 1 minute past deadline
    const iterations = 1000; // generous iteration cap — must NOT save the stuck discovery
    const currentGeneration = 5;

    // First call should bound the wait by wall-clock, NOT by the iteration
    // count fallback (which was 20 generations historically).
    let cleared = false;
    for (let i = 0; i < 5; i++) {
      neat.finishUp(iterations, endTimeMS, start, currentGeneration);
      if (neat.discoveryInProgress.size === 0) {
        cleared = true;
        break;
      }
    }
    assert(
      cleared,
      "Stuck discovery should be cleared within a few generations after wall-clock deadline expires",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: sets cleanup delay when work was in progress", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate training in progress on first call
    neat.trainingInProgress.set("uuid-1", Promise.resolve());
    neat.finishUp();

    // Now clear the in-progress work
    neat.trainingInProgress.clear();

    // Should still return false due to cleanup delay
    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should wait for cleanup delay after work completes",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

/**
 * Issue #3823: the additional-generation wait must be self-limiting.
 *
 * `NeatEvolution.evolve()` also decrements the counter, but the finish-up wait
 * loop does not always reach `evolve()` — the over-run guard stops starting
 * new generations and re-enters `finishUp()` directly. When `finishUp()` did
 * not decrement, that branch never cleared and the caller spun, flooding the
 * log with `Waiting for additional generation`.
 */
Deno.test("finishUp: the additional-generation wait clears without another evolve() call", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.additionalGenerationCount = 3;

    // Repeated calls with no evolve() in between must converge, in no more
    // calls than the requested generations (plus the finishing call).
    let calls = 0;
    while (!neat.finishUp()) {
      calls++;
      assert(
        calls <= 3,
        "finishUp must not wait for more additional generations than were requested",
      );
    }

    assertEquals(
      calls,
      3,
      "each waiting call must consume exactly one requested additional generation",
    );
    assertEquals(
      neat.additionalGenerationCount,
      0,
      "the additional-generation counter must be drained once the wait clears",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Issue #4099: a result that settles after the last processCompletedResults()
// ============================================================================

/**
 * Record what the code under test logs, separating warnings, then restore the
 * previous logger. Installed after construction, as the Neat constructor
 * replaces the logger from its resolved config.
 */
function captureLog(): {
  warnings: string[];
  lines: string[];
  restore: () => void;
} {
  const warnings: string[] = [];
  const lines: string[] = [];
  const previous = getLogger();
  const recorder: Logger = {
    debug: (...args: unknown[]) => lines.push(args.join(" ")),
    info: (...args: unknown[]) => lines.push(args.join(" ")),
    warn: (...args: unknown[]) => {
      warnings.push(args.join(" "));
      lines.push(args.join(" "));
    },
    error: (...args: unknown[]) => lines.push(args.join(" ")),
  };
  setLogger(recorder);
  return { warnings, lines, restore: () => setLogger(previous) };
}

/** A training result as `recordTrainingComplete` would have pushed it. */
function settledTraining(taskID: number, ID: string): ResponseData {
  return {
    taskID,
    duration: 1,
    train: { ID, creature: {} as never, error: 0.5 },
  } as never;
}

/** A discovery result as `recordDiscoveryComplete` would have pushed it. */
function settledDiscovery(taskID: number, ID: string): ResponseData {
  return {
    taskID,
    duration: 1,
    discover: { ID, creature: {} as never, config: {} as never },
  } as never;
}

Deno.test("finishUp: waits while a settled training result is unmerged, then finishes (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Settled after the last processCompletedResults(): nothing is in progress.
    neat.trainingComplete.push(settledTraining(1, "abc12345"));

    assertEquals(
      neat.finishUp(),
      false,
      "a settled training result that has not been merged must hold finishUp open",
    );

    // evolve() runs processCompletedResults(), which clears the array; stand in for it.
    neat.trainingComplete.length = 0;

    assertEquals(
      neat.finishUp(),
      true,
      "once the settled result is merged the run may finish",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: waits while a settled discovery result is unmerged, then finishes (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.discoveryComplete.push(settledDiscovery(2, "def12345"));

    assertEquals(
      neat.finishUp(),
      false,
      "a settled discovery result that has not been merged must hold finishUp open",
    );

    neat.discoveryComplete.length = 0;

    assertEquals(
      neat.finishUp(),
      true,
      "once the settled result is merged the run may finish",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: an over-run stop does not wait on results it will never merge (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // The over-run path never calls evolve() again, so waiting here would spin
    // until the hard deadline. Teardown discards these instead.
    neat.terminationReason = "overrun";
    neat.trainingComplete.push(settledTraining(3, "abc12345"));
    neat.discoveryComplete.push(settledDiscovery(4, "def12345"));

    assertEquals(
      neat.finishUp(),
      true,
      "an over-run stop must finish without waiting on unmerged results",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("discardUnprocessedResults: returns the count, empties both queues and names each task (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  let log: ReturnType<typeof captureLog> | undefined;

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.trainingComplete.push(settledTraining(1, "abc12345"));
    neat.discoveryComplete.push(settledDiscovery(2, "def12345"));

    log = captureLog();
    const discarded = neat.discardUnprocessedResults();

    assertEquals(discarded, 2, "every unmerged result must be counted");
    assertEquals(neat.trainingComplete.length, 0);
    assertEquals(neat.discoveryComplete.length, 0);
    assertEquals(
      log.warnings.length,
      2,
      "each discarded result must be logged once at warn level",
    );
    assert(
      log.warnings.some((l) =>
        l.includes("Training abc12345 discarded at teardown")
      ),
      `the training discard must name its task ID; got: ${
        log.warnings.join(" | ")
      }`,
    );
    assert(
      log.warnings.some((l) =>
        l.includes("Discovery def12345 discarded at teardown")
      ),
      `the discovery discard must name its task ID; got: ${
        log.warnings.join(" | ")
      }`,
    );
  } finally {
    log?.restore();
    await terminateWorkers(workers);
  }
});

Deno.test("discardUnprocessedResults: with nothing unmerged it returns 0 and logs nothing (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  let log: ReturnType<typeof captureLog> | undefined;

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    log = captureLog();
    assertEquals(neat.discardUnprocessedResults(), 0);
    assertEquals(
      log.lines.length,
      0,
      "a teardown with nothing unmerged must not log anything",
    );
  } finally {
    log?.restore();
    await terminateWorkers(workers);
  }
});

/** A failed training task as `recordTrainingTaskFailure` queues it (error Infinity). */
function failedTrainingStub(taskID: number, ID: string): ResponseData {
  return {
    taskID,
    duration: 0,
    train: {
      ID,
      creature: {} as never,
      error: Number.POSITIVE_INFINITY,
      trace: { input: 2, output: 1, neurons: [], synapses: [] } as never,
    },
  } as never;
}

/** Strip ANSI colour codes so assertions see the plain text of a log line. */
function stripAnsi(text: string): string {
  return text.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
    "",
  );
}

Deno.test("discardUnprocessedResults: skips a failed-task stub but still logs and counts a finite result (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  let log: ReturnType<typeof captureLog> | undefined;

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // The failed task already logged its own `Training failed for creature`
    // terminal line, so its stub must not produce a second one.
    neat.trainingComplete.push(failedTrainingStub(1, "fail1234"));
    neat.trainingComplete.push(settledTraining(2, "abc12345"));

    log = captureLog();
    const discarded = neat.discardUnprocessedResults();

    assertEquals(
      discarded,
      1,
      "only the finite-error result must be counted as discarded",
    );
    assertEquals(
      neat.trainingComplete.length,
      0,
      "the failed-task stub must still be cleared from the queue",
    );
    assertEquals(
      log.warnings.length,
      1,
      "only the finite-error result must be logged",
    );
    assert(
      log.warnings[0].includes("Training abc12345 discarded at teardown"),
      `the finite-error discard must name its task ID; got: ${
        log.warnings.join(" | ")
      }`,
    );
    assert(
      !log.lines.some((l) => l.includes("fail1234")),
      `the failed-task stub must not be named again; got: ${
        log.lines.join(" | ")
      }`,
    );
  } finally {
    log?.restore();
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: a settled training result is merged by processCompletedResults, then the run finishes (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  let log: ReturnType<typeof captureLog> | undefined;

  try {
    const options: NeatOptions = { populationSize: 10, verbose: true };
    const neat = new Neat(2, 1, options, workers);
    const fittest = new Creature(2, 1);
    const trained = new Creature(2, 1);

    // A training task in flight, registered the way the scheduler registers it.
    const uuid = "late-task-4099";
    neat.trainingInProgress.set(uuid, Promise.resolve());

    // It settles through the production hook, after the last generation's
    // processCompletedResults() has run.
    const recorded = neat.recordTrainingComplete(uuid, neat.abandonEpoch, {
      taskID: 1,
      duration: 1,
      train: {
        ID: "late1234",
        creature: trained.exportJSON(),
        error: 0.5,
      },
    } as never);
    assert(recorded, "the in-flight training result must be recorded");
    assert(
      !neat.trainingInProgress.has(uuid),
      "recording a result must release its in-flight task",
    );
    assertEquals(
      neat.trainingComplete.length,
      1,
      "the settled result must be queued for merging",
    );

    log = captureLog();

    assertEquals(
      neat.finishUp(),
      false,
      "a settled training result that has not been merged must hold finishUp open",
    );

    const merged = processCompletedResults(neat, fittest, {} as never);

    const late = merged.filter((c) => getTag(c, "trainID") === "late1234");
    assert(
      merged.length >= 1,
      "processCompletedResults must return the settled training result",
    );
    assertEquals(
      late.length,
      1,
      "the merged creature must be tagged with the settled task's trainID",
    );

    const plain = stripAnsi(log.lines.join("\n"));
    assert(
      /Training\s+late1234\s+completed/.test(plain),
      `the merge must log the settled task's completion; got: ${plain}`,
    );

    assertEquals(
      neat.finishUp(),
      true,
      "once the settled result is merged the run may finish",
    );
  } finally {
    log?.restore();
    await terminateWorkers(workers);
  }
});

Deno.test("discardUnprocessedResults: a result with no task payload is still logged as unknown and counted (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  let log: ReturnType<typeof captureLog> | undefined;

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.trainingComplete.push({ taskID: 5, duration: 1 } as never);
    neat.discoveryComplete.push({ taskID: 6, duration: 1 } as never);

    log = captureLog();
    const discarded = neat.discardUnprocessedResults();

    assertEquals(discarded, 2, "a result without a payload must be counted");
    assertEquals(neat.trainingComplete.length, 0);
    assertEquals(neat.discoveryComplete.length, 0);
    assert(
      log.warnings.some((l) => l.includes("Training unknown discarded")),
      `an unnamed training result must be logged as unknown; got: ${
        log.warnings.join(" | ")
      }`,
    );
    assert(
      log.warnings.some((l) => l.includes("Discovery unknown discarded")),
      `an unnamed discovery result must be logged as unknown; got: ${
        log.warnings.join(" | ")
      }`,
    );
  } finally {
    log?.restore();
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: an over-run stop with only one kind of unmerged result still finishes (Issue #4099)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.terminationReason = "overrun";
    neat.trainingComplete.push(settledTraining(7, "abc12345"));
    assertEquals(neat.finishUp(), true, "training only, over-run");

    neat.trainingComplete.length = 0;
    neat.discoveryComplete.push(settledDiscovery(8, "def12345"));
    assertEquals(neat.finishUp(), true, "discovery only, over-run");
  } finally {
    await terminateWorkers(workers);
  }
});
