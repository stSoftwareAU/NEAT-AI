import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type BoundedEvolveTeardownOptions,
  DEFAULT_TEARDOWN_STEP_BUDGET_MS,
  runBoundedEvolveTeardown,
  type TerminableWorker,
} from "@creature/BoundedEvolveTeardown.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/**
 * GRQ #4472: unit cover for the bounded post-loop teardown.
 *
 * Every deadline here is driven by an injected clock with a 1 ms poll, so no
 * test waits on real time passing (policy #2888). Assertions are on outcomes —
 * what was persisted, what was terminated, what was left detached — never on
 * how the teardown got there.
 */

const POLL_MS = 1;
const BUDGET_MS = 100;

/** A replay queue that drains immediately. */
function drainingQueue() {
  let abandoned = 0;
  return {
    abandonCount: () => abandoned,
    queue: {
      waitForCompletion: () => Promise.resolve(),
      isReplayInProgress: () => false,
      abandonInFlightReplay: () => {
        abandoned++;
        return true;
      },
    },
  };
}

/** A replay queue whose drain never settles — only a budget can release it. */
function wedgedQueue() {
  let abandoned = 0;
  return {
    abandonCount: () => abandoned,
    queue: {
      waitForCompletion: () => new Promise<void>(() => {}),
      isReplayInProgress: () => true,
      abandonInFlightReplay: () => {
        abandoned++;
        return true;
      },
    },
  };
}

/** A clock that jumps past `deadline` on its second reading. */
function jumpingClock(startMS: number, jumpToMS: number): () => number {
  let reads = 0;
  return () => (reads++ === 0 ? startMS : jumpToMS);
}

function baseOptions(
  overrides: Partial<BoundedEvolveTeardownOptions> = {},
): BoundedEvolveTeardownOptions {
  return {
    label: "test",
    persist: () => Promise.resolve(),
    replayQueue: drainingQueue().queue,
    hardDeadlineMS: 0,
    now: () => 1_000,
    budgetMS: BUDGET_MS,
    pollIntervalMS: POLL_MS,
    neat: {
      abandonInFlightAtTeardown: () => 0,
      discardUnprocessedResults: () => 0,
    },
    ...overrides,
  };
}

Deno.test("bounded teardown: the happy path terminates every worker and drains the queue", async () => {
  const stopped: number[] = [];
  const workers: TerminableWorker[] = [0, 1, 2].map((i) => ({
    terminate: () => {
      stopped.push(i);
    },
  }));

  const report = await runBoundedEvolveTeardown(
    baseOptions({ workers, hardDeadlineMS: 2_000 }),
  );

  assertEquals(report.workersTerminated, 3);
  assertEquals(report.workersAbandoned, 0);
  assertEquals(report.replayDrained, true);
  assertEquals(report.replayAbandoned, false);
  assertEquals(
    stopped.sort(),
    [0, 1, 2],
    "every worker must have been asked to stop",
  );
});

Deno.test("bounded teardown: a worker whose terminate() never resolves is detached, not awaited", async () => {
  const persisted: string[] = [];
  const workers: TerminableWorker[] = [
    { terminate: () => new Promise<void>(() => {}) },
  ];

  const report = await runBoundedEvolveTeardown(baseOptions({
    workers,
    persist: () => {
      persisted.push("best-creature");
      return Promise.resolve();
    },
    // The budget deadline is 1_000 + 100; the second clock read is past it.
    now: jumpingClock(1_000, 9_999),
    hardDeadlineMS: 0,
  }));

  assertEquals(
    report.workersAbandoned,
    1,
    "a worker that will not stop must be counted as detached",
  );
  assertEquals(report.workersTerminated, 0);
  assertEquals(
    persisted,
    ["best-creature"],
    "the champion must already be persisted before the wedged worker is met",
  );
});

Deno.test("bounded teardown: a worker whose terminate() throws is detached and the rest still stop", async () => {
  const stopped: number[] = [];
  const workers: TerminableWorker[] = [
    {
      terminate: () => {
        stopped.push(0);
      },
    },
    {
      terminate: () => {
        throw new Error("native scorer will not unwind");
      },
    },
    {
      terminate: () => {
        stopped.push(2);
      },
    },
  ];

  const report = await runBoundedEvolveTeardown(baseOptions({ workers }));

  assertEquals(report.workersAbandoned, 1);
  assertEquals(report.workersTerminated, 2);
  assertEquals(
    stopped.sort(),
    [0, 2],
    "a throwing terminate() must not stop the remaining workers being asked",
  );
});

Deno.test("bounded teardown: a replay drain that never settles is abandoned at its budget", async () => {
  const wedged = wedgedQueue();

  const report = await runBoundedEvolveTeardown(baseOptions({
    replayQueue: wedged.queue,
    hardDeadlineMS: 2_000,
    // Drain deadline is max(2_000, now) + 100; the second read clears it.
    now: jumpingClock(1_000, 9_999),
  }));

  assertEquals(report.replayDrained, false);
  assertEquals(
    report.replayAbandoned,
    true,
    "a drain past its budget must be reported as abandoned",
  );
  assertEquals(
    wedged.abandonCount(),
    1,
    "the in-flight replay must be signalled to abort exactly once",
  );
});

Deno.test("bounded teardown: an uncapped run keeps the unbounded Issue #1509 drain", async () => {
  const draining = drainingQueue();

  const report = await runBoundedEvolveTeardown(baseOptions({
    replayQueue: draining.queue,
    hardDeadlineMS: 0,
    // Far past any budget: an uncapped run must still wait for the drain.
    now: () => Number.MAX_SAFE_INTEGER,
  }));

  assertEquals(report.replayDrained, true);
  assertEquals(
    draining.abandonCount(),
    0,
    "an uncapped run must never abandon a replay that completes",
  );
});

Deno.test("bounded teardown: a failing drain is logged and the teardown still returns", async () => {
  let abandoned = 0;
  const report = await runBoundedEvolveTeardown(baseOptions({
    replayQueue: {
      waitForCompletion: () => Promise.reject(new Error("replay blew up")),
      isReplayInProgress: () => false,
      abandonInFlightReplay: () => {
        abandoned++;
        return true;
      },
    },
    hardDeadlineMS: 2_000,
  }));

  assertEquals(
    report.replayDrained,
    true,
    "a drain that fails has still finished — it is not left running",
  );
  assertEquals(abandoned, 0);
});

Deno.test("bounded teardown: a failed persist is re-thrown loudly, after the workers are down", async () => {
  const stopped: number[] = [];
  const workers: TerminableWorker[] = [
    {
      terminate: () => {
        stopped.push(0);
      },
    },
  ];

  await assertRejects(
    () =>
      runBoundedEvolveTeardown(baseOptions({
        workers,
        persist: () => Promise.reject(new Error("checkpoint write failed")),
      })),
    Error,
    "checkpoint write failed",
  );

  assertEquals(
    stopped,
    [0],
    "a failed persist must never leave a live worker pool behind",
  );
});

Deno.test("bounded teardown: a non-positive budget falls back to the default", async () => {
  // A zero budget must not mean "abandon everything immediately": the clock
  // never reaches the default budget here, so the wedge-free path completes.
  const report = await runBoundedEvolveTeardown(baseOptions({
    budgetMS: 0,
    hardDeadlineMS: 1_000,
    now: () => 1_000,
  }));

  assert(
    DEFAULT_TEARDOWN_STEP_BUDGET_MS > 0,
    "the default budget must be positive",
  );
  assertEquals(report.replayDrained, true);
});

Deno.test("bounded teardown: unmerged work is named after persist and worker termination, and counted (Issue #4099)", async () => {
  const order: string[] = [];
  const workers: TerminableWorker[] = [
    {
      terminate: () => {
        order.push("terminate");
      },
    },
  ];

  const report = await runBoundedEvolveTeardown(baseOptions({
    neat: {
      abandonInFlightAtTeardown: () => {
        order.push("abandon");
        return 1;
      },
      discardUnprocessedResults: () => {
        order.push("discard");
        return 2;
      },
    },
    persist: () => {
      order.push("persist");
      return Promise.resolve();
    },
    workers,
  }));

  assertEquals(
    report.resultsDiscarded,
    2,
    "the report must carry the number of results discarded at teardown",
  );
  assertEquals(
    report.tasksAbandoned,
    1,
    "the report must carry the number of in-flight tasks abandoned",
  );
  assertEquals(
    order,
    ["persist", "terminate", "abandon", "discard"],
    "in-flight tasks and unmerged results are named last, once nothing more can settle",
  );
});

Deno.test("bounded teardown: a result that settles while persisting is still discarded by name (Issue #4099)", async () => {
  const queued: string[] = [];
  const named: string[] = [];

  const report = await runBoundedEvolveTeardown(baseOptions({
    neat: {
      abandonInFlightAtTeardown: () => 0,
      discardUnprocessedResults: () => {
        named.push(...queued);
        return queued.length;
      },
    },
    // The result arrives during the persist's await, as `writeCreatures` /
    // `flushTrainingGainLog` leave the event loop free to settle a task.
    persist: async () => {
      await Promise.resolve();
      queued.push("late-task");
    },
  }));

  assertEquals(named, ["late-task"]);
  assertEquals(report.resultsDiscarded, 1);
});

Deno.test("bounded teardown: unmerged work is still named when persist fails (Issue #4099)", async () => {
  let abandonCalls = 0;
  let discardCalls = 0;

  await assertRejects(
    () =>
      runBoundedEvolveTeardown(baseOptions({
        neat: {
          abandonInFlightAtTeardown: () => {
            abandonCalls++;
            return 0;
          },
          discardUnprocessedResults: () => {
            discardCalls++;
            return 0;
          },
        },
        persist: () => Promise.reject(new Error("disk full")),
      })),
    Error,
    "disk full",
  );

  assertEquals([abandonCalls, discardCalls], [1, 1]);
});

/** Grace period handed to the injected exit guard (Issue #4126). */
const GRACE_MS = 1_234;

/**
 * Run `body` with the global logger swapped for one that records every warn
 * line, restoring the previous logger afterwards so no other test sees it.
 */
async function captureWarnings<T>(
  body: () => Promise<T>,
): Promise<{ value: T; warnings: string[] }> {
  const warnings: string[] = [];
  const capture: Logger = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    },
    error: () => {},
  };
  const previous = getLogger();
  setLogger(capture);
  try {
    const value = await body();
    return { value, warnings };
  } finally {
    setLogger(previous);
  }
}

/**
 * A fake exit guard. Its `schedule` records the grace period it was armed with
 * and holds the callback; nothing fires on its own, so no test waits on a real
 * timer. `fire()` stands in for the grace period elapsing.
 */
function fakeExitGuard() {
  const scheduledMS: number[] = [];
  const exitCodes: number[] = [];
  let armedCallback: (() => void) | undefined;
  return {
    scheduledMS,
    exitCodes,
    guard: {
      graceMS: GRACE_MS,
      exit: (code: number) => {
        exitCodes.push(code);
      },
      schedule: (fn: () => void, ms: number) => {
        scheduledMS.push(ms);
        armedCallback = fn;
      },
    },
    fire: () => armedCallback?.(),
  };
}

/** A worker whose `terminate()` returns but whose thread cannot be stopped. */
function unreclaimableWorker(): TerminableWorker {
  return { terminate: () => {}, couldNotBeStopped: () => true };
}

Deno.test("bounded teardown (Issue #4126): a worker that terminates but could not be stopped is counted and named", async () => {
  const { value: report, warnings } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      workers: [unreclaimableWorker()],
    }))
  );

  assertEquals(
    report.workersTerminated,
    1,
    "terminate() returned, so the worker is still terminated",
  );
  assertEquals(
    report.workersUnreclaimable,
    1,
    "a terminated worker still reporting couldNotBeStopped() is unreclaimable",
  );
  const named = warnings.filter((w) => w.includes("could not be stopped"));
  assertEquals(
    named.length,
    1,
    "exactly one warn line must name the unreclaimable worker",
  );
  assert(
    named[0].includes("1 worker(s) could not be stopped"),
    `the warn line must name the count, got: ${named[0]}`,
  );
  assert(
    named[0].includes("call Deno.exit() once your work is done"),
    "with the exit option off the warn line must tell the caller to exit",
  );
});

Deno.test("bounded teardown (Issue #4126): a worker that is not reported as unstoppable is not counted and not named", async () => {
  const { value: report, warnings } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      workers: [
        { terminate: () => {} },
        { terminate: () => {}, couldNotBeStopped: () => false },
      ],
    }))
  );

  assertEquals(report.workersTerminated, 2);
  assertEquals(
    report.workersUnreclaimable,
    0,
    "absent or false couldNotBeStopped() must leave the count at zero",
  );
  assertEquals(
    warnings.filter((w) => w.includes("could not be stopped")),
    [],
    "no unreclaimable warning when every worker is reclaimable",
  );
});

Deno.test("bounded teardown (Issue #4126): detached and unstoppable workers are each counted once", async () => {
  const { value: report, warnings } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      workers: [
        // Throws, and also reports unstoppable: counted once, as detached.
        {
          terminate: () => {
            throw new Error("native scorer will not unwind");
          },
          couldNotBeStopped: () => true,
        },
        unreclaimableWorker(),
      ],
    }))
  );

  assertEquals(report.workersAbandoned, 1);
  assertEquals(report.workersTerminated, 1);
  assertEquals(
    report.workersUnreclaimable,
    2,
    "the detached worker and the unstoppable one, each counted once",
  );
  assert(
    warnings.some((w) => w.includes("2 worker(s) could not be stopped")),
    "the warn line must carry the combined count",
  );
});

Deno.test("bounded teardown (Issue #4126): with the exit option off an unreclaimable worker arms nothing", async () => {
  const guard = fakeExitGuard();
  const { value: report, warnings } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      workers: [unreclaimableWorker()],
      exitGuard: guard.guard,
    }))
  );

  assertEquals(report.workersUnreclaimable, 1);
  assertEquals(
    guard.scheduledMS,
    [],
    "the exit guard must not be armed when exitOnUnreclaimableWorkers is off",
  );
  assert(
    warnings.some((w) => w.includes("call Deno.exit() once your work is done")),
    "the caller must be told to exit itself",
  );
});

Deno.test("bounded teardown (Issue #4126): with the exit option on but no unreclaimable worker, nothing is armed", async () => {
  const guard = fakeExitGuard();
  const { value: report, warnings } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      workers: [{ terminate: () => {} }],
      exitOnUnreclaimableWorkers: true,
      exitGuard: guard.guard,
    }))
  );

  assertEquals(report.workersUnreclaimable, 0);
  assertEquals(
    guard.scheduledMS,
    [],
    "a clean teardown must never arm the exit guard",
  );
  assertEquals(
    warnings.filter((w) => w.includes("could not be stopped")),
    [],
    "a clean teardown must not warn about unstoppable workers",
  );
});

Deno.test("bounded teardown (Issue #4126): with the exit option on and an unreclaimable worker, the guard is armed for the label and count", async () => {
  const guard = fakeExitGuard();
  const { value: report, warnings } = await captureWarnings(async () => {
    const result = await runBoundedEvolveTeardown(baseOptions({
      label: "evolveDir",
      workers: [unreclaimableWorker()],
      exitOnUnreclaimableWorkers: true,
      exitGuard: guard.guard,
    }));
    // The guard's own timer callback names the label and count it was armed
    // with, then exits. Fire it to observe exactly that.
    guard.fire();
    return result;
  });

  assertEquals(report.workersUnreclaimable, 1);
  assertEquals(
    guard.scheduledMS,
    [GRACE_MS],
    "the guard must be armed once, with the caller's grace period",
  );
  assertEquals(
    guard.exitCodes.length,
    1,
    "the armed guard must exit once its grace period elapses",
  );
  assert(
    warnings.some((w) =>
      w.startsWith("[evolveDir] teardown: 1 worker(s) could not be stopped") &&
      w.includes("will be exited after the grace period")
    ),
    "the teardown warn line must name the label and count and say the process will be exited",
  );
  assert(
    warnings.some((w) =>
      w.startsWith("evolveDir: 1 worker thread(s) could not be stopped")
    ),
    "the armed guard must be armed with the same label and count",
  );
});

Deno.test("bounded teardown (Issue #4126): a failed persist still arms the guard before the rethrow", async () => {
  const guard = fakeExitGuard();
  await captureWarnings(() =>
    assertRejects(
      () =>
        runBoundedEvolveTeardown(baseOptions({
          workers: [unreclaimableWorker()],
          persist: () => Promise.reject(new Error("checkpoint write failed")),
          exitOnUnreclaimableWorkers: true,
          exitGuard: guard.guard,
        })),
      Error,
      "checkpoint write failed",
    )
  );

  assertEquals(
    guard.scheduledMS,
    [GRACE_MS],
    "the guard must be armed before the rethrow, or the caller hangs after the error",
  );
});

Deno.test("bounded teardown (Issue #4126): a worker whose async terminate() settles but could not be stopped is counted", async () => {
  const { value: report } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      workers: [{
        terminate: () => Promise.resolve(),
        couldNotBeStopped: () => true,
      }],
    }))
  );

  assertEquals(report.workersTerminated, 1);
  assertEquals(report.workersAbandoned, 0);
  assertEquals(report.workersUnreclaimable, 1);
});

Deno.test("bounded teardown (Issue #4126): a worker whose async terminate() settles and could be stopped is not counted", async () => {
  const { value: report, warnings } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      workers: [{
        terminate: () => Promise.resolve(),
        couldNotBeStopped: () => false,
      }],
    }))
  );

  assertEquals(report.workersTerminated, 1);
  assertEquals(report.workersUnreclaimable, 0);
  assertEquals(
    warnings.filter((w) => w.includes("could not be stopped")).length,
    0,
  );
});

Deno.test("bounded teardown (Issue #4126): a worker that is not reported as unstoppable is counted as zero unreclaimable", async () => {
  const report = await runBoundedEvolveTeardown(baseOptions({
    workers: [{ terminate: () => {} }, { terminate: () => {} }],
  }));

  assertEquals(report.workersTerminated, 2);
  assertEquals(report.workersUnreclaimable, 0);
});

Deno.test("bounded teardown (Issue #4126): the exit warning is only logged by the exit-armed path and names the label", async () => {
  const guard = fakeExitGuard();
  const { warnings } = await captureWarnings(() =>
    runBoundedEvolveTeardown(baseOptions({
      label: "evolveDir",
      workers: [unreclaimableWorker(), unreclaimableWorker()],
      exitOnUnreclaimableWorkers: true,
      exitGuard: guard.guard,
    }))
  );

  const named = warnings.filter((w) => w.includes("could not be stopped"));
  assert(
    named.some((w) =>
      w.includes("[evolveDir] teardown: 2 worker(s) could not be stopped") &&
      w.includes("it will be exited after the grace period")
    ),
    `the teardown warning must name the label, count and exit, got: ${
      named.join(" | ")
    }`,
  );
  guard.fire();
  assertEquals(guard.exitCodes.length, 1, "the armed guard exits once");
});
