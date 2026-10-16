import { assertEquals } from "@std/assert";
import {
  computeWatchdogDeadlineEpochMS,
  DEFAULT_WATCHDOG_MARGIN_MS,
} from "../../src/NEAT/HardDeadline.ts";

// Issue #4067: the event-loop watchdog deadline is anchored on the real clock
// plus the remaining injected budget. All inputs are passed in, so the test
// reads no clock (#2888).

Deno.test("computeWatchdogDeadlineEpochMS: adds the remaining injected budget and the margin to the real clock", () => {
  assertEquals(
    computeWatchdogDeadlineEpochMS(5_000_000, 2_060_000, 2_000_000, 300_000),
    5_360_000,
  );
});

Deno.test("computeWatchdogDeadlineEpochMS: a bound already behind the injected clock contributes nothing", () => {
  assertEquals(
    computeWatchdogDeadlineEpochMS(5_000_000, 1_000_000, 2_000_000, 300_000),
    5_300_000,
  );
});

Deno.test("computeWatchdogDeadlineEpochMS: a bound exactly at the injected clock contributes nothing", () => {
  assertEquals(
    computeWatchdogDeadlineEpochMS(5_000_000, 2_000_000, 2_000_000, 300_000),
    5_300_000,
  );
});

Deno.test("DEFAULT_WATCHDOG_MARGIN_MS is five minutes", () => {
  assertEquals(DEFAULT_WATCHDOG_MARGIN_MS, 300_000);
});
