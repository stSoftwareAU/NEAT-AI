import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  armFirstGenerationWatchdog,
  fireFirstGenerationWatchdog,
  isFirstGenerationWatchdogDue,
  withFirstGenerationWatchdog,
} from "@neat/FirstGenerationWatchdog.ts";

/**
 * Issue #4060: the off-thread first-generation watchdog. The decision and the
 * side effects are injectable, so none of this kills the test process; the
 * end-to-end kill is covered by `test/creature/FirstGenerationBlockedEventLoop.ts`.
 */

const REQUEST = { deadlineMS: 1_000, slackMS: 500 };

Deno.test("isFirstGenerationWatchdogDue: only strictly past deadline + slack", () => {
  assertEquals(isFirstGenerationWatchdogDue(1_499, REQUEST), false);
  assertEquals(isFirstGenerationWatchdogDue(1_500, REQUEST), false);
  assertEquals(isFirstGenerationWatchdogDue(1_501, REQUEST), true);
});

Deno.test("fireFirstGenerationWatchdog: logs the wedge and kills once", () => {
  const lines: string[] = [];
  let kills = 0;
  fireFirstGenerationWatchdog(90_000, { startMS: 0 }, {
    log: (line) => lines.push(line),
    kill: () => {
      kills++;
    },
  });
  assertEquals(lines.length, 1);
  assert(lines[0].includes("[Neat] First generation wedged after 90s"));
  assert(lines[0].includes("first-generation-wedged"));
  assert(lines[0].includes("main thread was not yielding"));
  assertEquals(kills, 1);
});

Deno.test("fireFirstGenerationWatchdog: a failing kill is reported, not thrown", () => {
  const lines: string[] = [];
  fireFirstGenerationWatchdog(90_000, { startMS: 0 }, {
    log: (line) => lines.push(line),
    kill: () => {
      throw new Deno.errors.NotCapable("Requires run access");
    },
  });
  assertEquals(lines.length, 2);
  assert(lines[1].includes("could not terminate the process"));
  assert(lines[1].includes("Requires run access"));
});

Deno.test("armFirstGenerationWatchdog: no bound means nothing is spawned", () => {
  assertEquals(armFirstGenerationWatchdog(0, 0), undefined);
});

// The terminated worker can outlive the test's op/resource accounting by a
// tick, so the sanitizers are off for the real-worker cases.
Deno.test({
  name: "withFirstGenerationWatchdog: returns the run's value",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const value = await withFirstGenerationWatchdog(
      0,
      Number.MAX_SAFE_INTEGER / 2,
      undefined,
      () => Promise.resolve(42),
    );
    assertEquals(value, 42);
  },
});

Deno.test({
  name: "withFirstGenerationWatchdog: a rejection propagates",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await assertRejects(
      () =>
        withFirstGenerationWatchdog(
          0,
          Number.MAX_SAFE_INTEGER / 2,
          undefined,
          () => Promise.reject(new Error("boom")),
        ),
      Error,
      "boom",
    );
  },
});
