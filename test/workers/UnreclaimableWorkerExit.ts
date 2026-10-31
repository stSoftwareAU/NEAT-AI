/**
 * Tests for the opt-in exit armed when unstoppable worker threads are the only
 * thing holding the process open (Issue #4126).
 *
 * No test waits on a real timer. The scheduler and the exit are injected, so
 * each test runs the captured callback by hand.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { ValidationError } from "@errors/ValidationError.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import {
  armUnreclaimableWorkerExit,
  UNRECLAIMABLE_WORKER_EXIT_GRACE_MS,
} from "@workers/UnreclaimableWorkerExit.ts";

interface ScheduledExit {
  fn: () => void;
  ms: number;
}

/** A scheduler that records the callback and delay instead of running them. */
function captureSchedule(): {
  scheduled: ScheduledExit[];
  schedule: (fn: () => void, ms: number) => void;
} {
  const scheduled: ScheduledExit[] = [];
  return {
    scheduled,
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
    },
  };
}

Deno.test("nothing exits until the armed timer fires (Issue #4126)", () => {
  const { scheduled, schedule } = captureSchedule();
  const exits: number[] = [];

  armUnreclaimableWorkerExit({
    label: "evolveDir",
    count: 1,
    schedule,
    exit: (code) => exits.push(code),
  });

  assertEquals(scheduled.length, 1, "exactly one timer is armed");
  assertEquals(exits, [], "no exit happens before the timer fires");

  scheduled[0].fn();
  assertEquals(exits.length, 1, "the fired timer exits the process once");
});

Deno.test("the armed exit passes the exit code the process carries when it fires (Issue #4126)", () => {
  const { scheduled, schedule } = captureSchedule();
  const exits: number[] = [];
  const previous = Deno.exitCode;

  try {
    armUnreclaimableWorkerExit({
      label: "evolveDir",
      count: 2,
      schedule,
      exit: (code) => exits.push(code),
    });
    // Changed after arming, so the exit must read the code at fire time.
    Deno.exitCode = 3;
    scheduled[0].fn();
  } finally {
    Deno.exitCode = previous;
  }

  assertEquals(exits, [3], "the exit code is preserved, not reset to 0");
});

Deno.test("the warning names the label, count and grace, and is only logged when the exit fires (Issue #4126)", () => {
  const { scheduled, schedule } = captureSchedule();
  const previous = getLogger();
  const warnings: string[] = [];
  const capture: Logger = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    },
    error: () => {},
  };
  const exits: number[] = [];

  try {
    setLogger(capture);
    armUnreclaimableWorkerExit({
      label: "evolveDir",
      count: 2,
      schedule,
      exit: (code) => exits.push(code),
    });
    assertEquals(
      warnings,
      [],
      "nothing is logged while the exit is only armed",
    );

    scheduled[0].fn();
  } finally {
    setLogger(previous);
  }

  assertEquals(warnings.length, 1, "one warning is logged when the exit fires");
  const message = warnings[0];
  assert(message.includes("evolveDir"), `names the label: ${message}`);
  assert(message.includes("2 worker thread"), `names the count: ${message}`);
  assert(
    message.includes(`${UNRECLAIMABLE_WORKER_EXIT_GRACE_MS} ms`),
    `names the grace: ${message}`,
  );
  assert(
    message.includes("would otherwise keep it alive"),
    `says why the process is exited: ${message}`,
  );
  assert(
    message.includes("Exit code"),
    `says the exit code is preserved: ${message}`,
  );
  assertEquals(exits.length, 1);
});

Deno.test("the default grace is used when graceMS is omitted (Issue #4126)", () => {
  const { scheduled, schedule } = captureSchedule();

  armUnreclaimableWorkerExit({
    label: "evolveDir",
    count: 1,
    schedule,
    exit: () => {},
  });

  assertEquals(scheduled[0].ms, UNRECLAIMABLE_WORKER_EXIT_GRACE_MS);
  assertEquals(
    UNRECLAIMABLE_WORKER_EXIT_GRACE_MS,
    10_000,
    "the default grace is ten seconds",
  );
});

Deno.test("an explicit graceMS is passed through to the scheduler (Issue #4126)", () => {
  const { scheduled, schedule } = captureSchedule();

  armUnreclaimableWorkerExit({
    label: "evolveDir",
    count: 1,
    graceMS: 250,
    schedule,
    exit: () => {},
  });

  assertEquals(scheduled[0].ms, 250);
});

Deno.test("count must be a positive integer, and nothing is armed otherwise (Issue #4126)", () => {
  for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { scheduled, schedule } = captureSchedule();
    assertThrows(
      () =>
        armUnreclaimableWorkerExit({
          label: "evolveDir",
          count,
          schedule,
          exit: () => {},
        }),
      ValidationError,
    );
    assertEquals(scheduled.length, 0, `nothing is armed for count ${count}`);
  }
});

Deno.test("graceMS must be positive and finite, and nothing is armed otherwise (Issue #4126)", () => {
  for (
    const graceMS of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]
  ) {
    const { scheduled, schedule } = captureSchedule();
    assertThrows(
      () =>
        armUnreclaimableWorkerExit({
          label: "evolveDir",
          count: 1,
          graceMS,
          schedule,
          exit: () => {},
        }),
      ValidationError,
    );
    assertEquals(
      scheduled.length,
      0,
      `nothing is armed for graceMS ${graceMS}`,
    );
  }
});
