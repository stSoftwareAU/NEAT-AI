import { assertEquals } from "@std/assert";
import {
  computeHardDeadlineTS,
  HARD_DEADLINE_GRACE_MINUTES,
} from "@neat/HardDeadline.ts";

// All assertions use absolute timestamps passed in (no real clock), per the
// policy in #2888: tests assert on returned timestamps, not elapsed wall-clock.
const START = 1_000_000_000_000; // fixed, arbitrary absolute millisecond epoch

Deno.test("HardDeadline - grace cap constant is 15 minutes", () => {
  assertEquals(HARD_DEADLINE_GRACE_MINUTES, 15);
});

Deno.test("HardDeadline - no timeout configured returns undefined", () => {
  assertEquals(computeHardDeadlineTS(START, 0), undefined);
});

Deno.test("HardDeadline - unset (undefined) timeout returns undefined", () => {
  assertEquals(
    computeHardDeadlineTS(START, undefined as unknown as number),
    undefined,
  );
});

Deno.test("HardDeadline - T=2 gives grace of 2 minutes", () => {
  // grace = min(15, max(1, 2)) = 2 minutes
  const expected = START + 2 * 60_000 + 2 * 60_000;
  assertEquals(computeHardDeadlineTS(START, 2), expected);
});

Deno.test("HardDeadline - T=45 caps grace at 15 minutes (T+15)", () => {
  // grace = min(15, max(1, 45)) = 15 minutes
  const expected = START + 45 * 60_000 + 15 * 60_000;
  assertEquals(computeHardDeadlineTS(START, 45), expected);
});

Deno.test("HardDeadline - T=120 clamps grace to 15 minutes", () => {
  // grace = min(15, max(1, 120)) = 15 minutes
  const expected = START + 120 * 60_000 + 15 * 60_000;
  assertEquals(computeHardDeadlineTS(START, 120), expected);
});

Deno.test("HardDeadline - T=1 gives grace of 1 minute", () => {
  // grace = min(15, max(1, 1)) = 1 minute
  const expected = START + 1 * 60_000 + 1 * 60_000;
  assertEquals(computeHardDeadlineTS(START, 1), expected);
});
