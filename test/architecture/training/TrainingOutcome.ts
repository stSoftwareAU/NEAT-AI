/**
 * Tests for training-outcome timeout computation (Issue #2899).
 *
 * `computeTimeoutTS` is pure and `now`-injectable, so these tests assert on
 * computed timestamps with injected clock values — no elapsed-time
 * measurement (#2888 policy).
 */

import { assertEquals } from "@std/assert";
import { computeTimeoutTS } from "@architecture/training/TrainingOutcome.ts";

// A fixed, injected "now" — never Date.now().
const NOW = 1_000_000_000_000;
const MINUTE_MS = 60 * 1000;

Deno.test("computeTimeoutTS - clamps to an earlier hard deadline", () => {
  // Relative budget would expire at NOW + 15 min, but the hard deadline is
  // only 5 minutes away → the hard deadline wins.
  const hardDeadlineTS = NOW + 5 * MINUTE_MS;
  const timeoutTS = computeTimeoutTS(NOW, 15, hardDeadlineTS);
  assertEquals(timeoutTS, hardDeadlineTS);
});

Deno.test("computeTimeoutTS - absent hard deadline reproduces relative budget", () => {
  // Exactly the pre-#2899 computation: now + minutes * 60 * 1000.
  assertEquals(computeTimeoutTS(NOW, 15), NOW + 15 * MINUTE_MS);
  assertEquals(computeTimeoutTS(NOW, 15, undefined), NOW + 15 * MINUTE_MS);
  // A zero hard deadline is treated as "no deadline".
  assertEquals(computeTimeoutTS(NOW, 15, 0), NOW + 15 * MINUTE_MS);
});

Deno.test("computeTimeoutTS - keeps relative budget when it is the earlier limit", () => {
  // Hard deadline is far in the future → the relative budget still governs.
  const hardDeadlineTS = NOW + 60 * MINUTE_MS;
  assertEquals(computeTimeoutTS(NOW, 10, hardDeadlineTS), NOW + 10 * MINUTE_MS);
});

Deno.test("computeTimeoutTS - no relative budget falls back to the hard deadline", () => {
  // trainingTimeOutMinutes === 0 (no relative budget) but a hard deadline is
  // present → the hard deadline caps the run.
  const hardDeadlineTS = NOW + 5 * MINUTE_MS;
  assertEquals(computeTimeoutTS(NOW, 0, hardDeadlineTS), hardDeadlineTS);
});

Deno.test("computeTimeoutTS - no budget and no deadline means no timeout", () => {
  assertEquals(computeTimeoutTS(NOW, 0), 0);
  assertEquals(computeTimeoutTS(NOW, 0, 0), 0);
});

Deno.test("computeTimeoutTS - hard deadline already in the past returns that past instant", () => {
  // A deadline earlier than `now` is returned verbatim; the per-iteration
  // timeout check then trips immediately and the best-so-far result returns.
  const pastDeadline = NOW - 5 * MINUTE_MS;
  assertEquals(computeTimeoutTS(NOW, 15, pastDeadline), pastDeadline);
});
