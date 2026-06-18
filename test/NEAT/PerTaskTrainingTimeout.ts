/**
 * Tests for the per-training-task wall-clock cap derivation (Issue #3053).
 *
 * `computePerTaskTimeoutMinutes` is pure, so these tests assert directly on
 * the clamped minute budget — no elapsed-time measurement (#2888 policy).
 */

import { assertEquals } from "@std/assert";
import {
  computePerTaskTimeoutMinutes,
  isPastTrainingDeadline,
  TRAINING_TASK_WATCHDOG_GRACE_MS,
} from "@neat/PerTaskTrainingTimeout.ts";

Deno.test("computePerTaskTimeoutMinutes - cap clamps a large remaining run", () => {
  // 180 minutes left in the run, but a single task may only run 3 minutes.
  assertEquals(computePerTaskTimeoutMinutes(180, 3), 3);
});

Deno.test("computePerTaskTimeoutMinutes - remaining wins when it is smaller", () => {
  // Only 2 minutes left in the run — never schedule a task longer than that.
  assertEquals(computePerTaskTimeoutMinutes(2, 5), 2);
});

Deno.test("computePerTaskTimeoutMinutes - no cap returns the remaining run unchanged", () => {
  assertEquals(computePerTaskTimeoutMinutes(180, 0), 180);
  assertEquals(computePerTaskTimeoutMinutes(180, undefined), 180);
});

Deno.test("computePerTaskTimeoutMinutes - negative remaining sentinel propagates", () => {
  // -1 means "no remaining run budget"; the cap must not turn it positive.
  assertEquals(computePerTaskTimeoutMinutes(-1, 5), -1);
});

Deno.test("computePerTaskTimeoutMinutes - zero remaining (no run deadline) uses the cap", () => {
  // 0 means no overall run deadline; a configured cap still bounds the task.
  assertEquals(computePerTaskTimeoutMinutes(0, 5), 5);
  // No cap and no run deadline → no timeout (0).
  assertEquals(computePerTaskTimeoutMinutes(0, 0), 0);
});

Deno.test("computePerTaskTimeoutMinutes - fractional cap rounds up to at least one minute", () => {
  // A sub-minute cap still yields at least a 1-minute floor so the worker
  // makes forward progress before the timeout trips.
  assertEquals(computePerTaskTimeoutMinutes(180, 0.5), 1);
  assertEquals(computePerTaskTimeoutMinutes(180, 2.4), 3);
});

Deno.test("isPastTrainingDeadline - trips only once now passes deadline + grace", () => {
  const deadline = 1_000_000;
  assertEquals(isPastTrainingDeadline(deadline, deadline + 100, 1000), false);
  assertEquals(isPastTrainingDeadline(deadline, deadline + 1000, 1000), false);
  assertEquals(isPastTrainingDeadline(deadline, deadline + 1001, 1000), true);
});

Deno.test("isPastTrainingDeadline - a non-positive deadline never trips", () => {
  assertEquals(isPastTrainingDeadline(0, 1_000_000, 0), false);
  assertEquals(isPastTrainingDeadline(-1, 1_000_000, 0), false);
});

Deno.test("isPastTrainingDeadline - defaults to the watchdog grace constant", () => {
  const deadline = 1_000_000;
  // Inside the default grace → not past; just beyond it → past.
  assertEquals(
    isPastTrainingDeadline(
      deadline,
      deadline + TRAINING_TASK_WATCHDOG_GRACE_MS,
    ),
    false,
  );
  assertEquals(
    isPastTrainingDeadline(
      deadline,
      deadline + TRAINING_TASK_WATCHDOG_GRACE_MS + 1,
    ),
    true,
  );
});
