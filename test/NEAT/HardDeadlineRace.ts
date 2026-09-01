import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  awaitWithinHardDeadline,
  HARD_DEADLINE_BREACHED,
} from "@neat/HardDeadlineRace.ts";

/**
 * GRQ #4470: unit cover for the hard-deadline race that bounds a single
 * `await` inside the evolve loop.
 *
 * The clock is injected and the poll interval is 1 ms, so no test here waits
 * on real time passing (policy #2888).
 */

const POLL_MS = 1;

Deno.test("awaitWithinHardDeadline: work that settles first returns its value", async () => {
  let breaches = 0;
  const now = () => 1_000;
  const outcome = await awaitWithinHardDeadline(
    Promise.resolve("done"),
    2_000,
    now,
    () => breaches++,
    POLL_MS,
  );

  assertEquals(outcome, "done");
  assertEquals(breaches, 0, "no breach may be reported when work wins");
});

Deno.test("awaitWithinHardDeadline: a never-settling promise ends at the deadline", async () => {
  let nowMS = 1_000;
  let breaches = 0;

  const outcome = await awaitWithinHardDeadline(
    // The child that never settles — only the deadline can release this.
    new Promise<string>(() => {
      nowMS = 5_000;
    }),
    2_000,
    () => nowMS,
    () => breaches++,
    POLL_MS,
  );

  assertEquals(
    outcome,
    HARD_DEADLINE_BREACHED,
    "past the cap the caller must be handed the breach sentinel",
  );
  assertEquals(breaches, 1, "onBreach must fire exactly once, when it happens");
  assert(nowMS > 2_000, "the injected clock must have passed the cap");
});

Deno.test("awaitWithinHardDeadline: an abandoned rejection is swallowed, not unhandled", async () => {
  let nowMS = 1_000;
  let rejectWork: ((reason: Error) => void) | undefined;
  const work = new Promise<string>((_resolve, reject) => {
    rejectWork = reject;
  });

  const outcome = await awaitWithinHardDeadline(
    work,
    2_000,
    () => {
      nowMS = 5_000;
      return nowMS;
    },
    () => {},
    POLL_MS,
  );
  assertEquals(outcome, HARD_DEADLINE_BREACHED);

  // The abandoned work fails after nobody is awaiting it: this must not
  // surface as an unhandled rejection (which would kill the run).
  assert(rejectWork, "the work promise must expose its reject handle");
  rejectWork(new Error("late failure from an abandoned generation"));
  await new Promise((resolve) => setTimeout(resolve, POLL_MS * 5));
});

Deno.test("awaitWithinHardDeadline: work that rejects before the deadline still rejects", async () => {
  await assertRejects(
    () =>
      awaitWithinHardDeadline(
        Promise.reject(new Error("boom")),
        Number.MAX_SAFE_INTEGER,
        () => 1_000,
        () => {},
        POLL_MS,
      ),
    Error,
    "boom",
  );
});

Deno.test("awaitWithinHardDeadline: no cap configured awaits the work unchanged", async () => {
  let breaches = 0;
  const outcome = await awaitWithinHardDeadline(
    Promise.resolve(42),
    0,
    () => Number.MAX_SAFE_INTEGER,
    () => breaches++,
    POLL_MS,
  );

  assertEquals(outcome, 42, "an uncapped run must not be bounded");
  assertEquals(breaches, 0, "an uncapped run can never breach");
});
