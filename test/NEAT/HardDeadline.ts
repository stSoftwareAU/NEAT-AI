import { assert, assertEquals } from "@std/assert";
import {
  computeFirstGenerationDeadlineTS,
  computeHardDeadlineTS,
  DEFAULT_OVERRUN_ENFORCEMENT_FACTOR,
  FIRST_GENERATION_MAX_EXTRA_MINUTES,
  FIRST_GENERATION_TIMEOUT_MULTIPLE,
  HARD_DEADLINE_GRACE_MINUTES,
  hasTrainingOverrun,
  shouldStopStartingGenerations,
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

Deno.test("hasTrainingOverrun - unset timeout never over-runs", () => {
  assertEquals(hasTrainingOverrun(START, 0, START + 60_000), false);
});

Deno.test("hasTrainingOverrun - elapsed at expected duration is not yet over", () => {
  assertEquals(
    hasTrainingOverrun(START, 1, START + 60_000),
    false,
  );
});

Deno.test("hasTrainingOverrun - elapsed past expected × factor is over", () => {
  assertEquals(
    hasTrainingOverrun(START, 1, START + 60_000 + 1),
    true,
  );
  assertEquals(
    hasTrainingOverrun(START, 15, START + 15 * 60_000 + 1),
    true,
  );
});

Deno.test("hasTrainingOverrun - configured factor of 2 needs 2× expected", () => {
  assertEquals(
    hasTrainingOverrun(START, 1, START + 90_000, 2),
    false,
  );
  assertEquals(
    hasTrainingOverrun(START, 1, START + 120_000 + 1, 2),
    true,
  );
});

Deno.test("shouldStopStartingGenerations - first generation is always allowed", () => {
  assertEquals(
    shouldStopStartingGenerations(0, START, 1, START + 120_000),
    false,
  );
});

Deno.test("shouldStopStartingGenerations - stops after a generation once over-run", () => {
  assertEquals(
    shouldStopStartingGenerations(1, START, 1, START + 60_000 + 1),
    true,
  );
});

Deno.test("over-run enforcement factor default is 1", () => {
  assertEquals(DEFAULT_OVERRUN_ENFORCEMENT_FACTOR, 1);
});

// Issue #4053: generation 1 is floored past the hard cap (#3940) but must
// still be bounded, or a wedged first generation hangs the run forever.
Deno.test("computeFirstGenerationDeadlineTS - constants are 4x and 60 minutes", () => {
  assertEquals(FIRST_GENERATION_TIMEOUT_MULTIPLE, 4);
  assertEquals(FIRST_GENERATION_MAX_EXTRA_MINUTES, 60);
});

Deno.test("computeFirstGenerationDeadlineTS - no timeout configured returns undefined", () => {
  assertEquals(computeFirstGenerationDeadlineTS(START, 0), undefined);
});

Deno.test("computeFirstGenerationDeadlineTS - T=5 adds 4T minutes to the hard cap", () => {
  // hard cap = 5 + 5 = 10 minutes; extra = min(60, 20) = 20 minutes
  assertEquals(
    computeFirstGenerationDeadlineTS(START, 5),
    START + 30 * 60_000,
  );
});

Deno.test("computeFirstGenerationDeadlineTS - T=15 adds 4T minutes to the hard cap", () => {
  // hard cap = 15 + 15 = 30 minutes; extra = min(60, 60) = 60 minutes
  assertEquals(
    computeFirstGenerationDeadlineTS(START, 15),
    START + 90 * 60_000,
  );
});

Deno.test("computeFirstGenerationDeadlineTS - T=60 is bound by the 60 minute ceiling", () => {
  // hard cap = 60 + 15 = 75 minutes; extra = min(60, 240) = 60 minutes
  assertEquals(
    computeFirstGenerationDeadlineTS(START, 60),
    START + 135 * 60_000,
  );
});

Deno.test("computeFirstGenerationDeadlineTS - is always later than the hard deadline", () => {
  for (const minutes of [0.5, 1, 5, 15, 45, 120]) {
    const hard = computeHardDeadlineTS(START, minutes)!;
    const first = computeFirstGenerationDeadlineTS(START, minutes)!;
    assert(first > hard, `T=${minutes}: ${first} must exceed ${hard}`);
  }
});
