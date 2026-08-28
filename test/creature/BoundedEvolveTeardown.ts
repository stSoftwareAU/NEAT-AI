import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type BoundedEvolveTeardownOptions,
  DEFAULT_TEARDOWN_STEP_BUDGET_MS,
  runBoundedEvolveTeardown,
  type TerminableWorker,
} from "@creature/BoundedEvolveTeardown.ts";

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
