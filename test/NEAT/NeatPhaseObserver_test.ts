/**
 * Issue #4096: `Neat.markPhase` reports the generation phase to the observer
 * installed with `Neat.setPhaseObserver`, so the off-main-thread watchdog can
 * name the phase in its breach line. With no observer it is a no-op, and an
 * observer that throws must not take the run down.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { Neat } from "@neat/Neat.ts";
import type { EventLoopWatchdogPhase } from "@neat/EventLoopWatchdog.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/** Captures every `warn` call; the other levels are silenced. */
function captureWarnings(): { warnings: unknown[][]; logger: Logger } {
  const warnings: unknown[][] = [];
  const logger: Logger = {
    debug(): void {},
    info(): void {},
    warn(...args: unknown[]): void {
      warnings.push(args);
    },
    error(): void {},
  };
  return { warnings, logger };
}

Deno.test("markPhase: the observer receives phases in the order they are marked", () => {
  const neat = new Neat(3, 1, {}, []);
  const received: EventLoopWatchdogPhase[] = [];
  neat.setPhaseObserver((phase) => received.push(phase));

  neat.markPhase("fitness");
  neat.markPhase("sort");
  neat.markPhase("write-scores");
  neat.markPhase("breeding");
  neat.markPhase("mutation");
  neat.markPhase("untracked");

  assertEquals(received, [
    "fitness",
    "sort",
    "write-scores",
    "breeding",
    "mutation",
    "untracked",
  ]);
});

Deno.test("markPhase: with no observer installed it is a no-op", () => {
  const neat = new Neat(3, 1, {}, []);
  const { warnings, logger } = captureWarnings();
  const original = getLogger();
  try {
    setLogger(logger);
    // Nothing to observe, so this must neither throw nor warn.
    neat.markPhase("fitness");
    neat.markPhase("deduplication");
  } finally {
    setLogger(original);
  }
  assertEquals(warnings.length, 0);
});

Deno.test("markPhase: clearing the observer stops further delivery", () => {
  const neat = new Neat(3, 1, {}, []);
  const received: EventLoopWatchdogPhase[] = [];
  neat.setPhaseObserver((phase) => received.push(phase));

  neat.markPhase("fitness");
  neat.setPhaseObserver(undefined);
  neat.markPhase("mutation");

  assertEquals(received, ["fitness"]);
});

Deno.test("markPhase: a throwing observer does not throw and logs a warning", () => {
  const neat = new Neat(3, 1, {}, []);
  neat.setPhaseObserver(() => {
    throw new Error("observer exploded");
  });
  const { warnings, logger } = captureWarnings();
  const original = getLogger();
  try {
    setLogger(logger);
    let thrown: unknown;
    try {
      neat.markPhase("sort");
    } catch (error) {
      thrown = error;
    }
    assertStrictEquals(thrown, undefined, "markPhase must not throw");
  } finally {
    setLogger(original);
  }

  assertEquals(warnings.length, 1);
  const message = String(warnings[0][0]);
  assertEquals(
    message.includes("observer exploded"),
    true,
    "the warning carries the observer's error message",
  );
  assertEquals(
    message.includes("sort"),
    true,
    "the warning names the phase that failed",
  );
});

Deno.test("markPhase: an observer that throws a non-Error value is logged by its string form", () => {
  const neat = new Neat(3, 1, {}, []);
  neat.setPhaseObserver(() => {
    // deno-lint-ignore no-throw-literal -- a non-Error throw is the case under test
    throw "plain string failure";
  });
  const { warnings, logger } = captureWarnings();
  const original = getLogger();
  try {
    setLogger(logger);
    neat.markPhase("breeding");
  } finally {
    setLogger(original);
  }

  assertEquals(warnings.length, 1);
  const message = String(warnings[0][0]);
  assertEquals(message.includes("plain string failure"), true);
  assertEquals(message.includes("breeding"), true);
});
