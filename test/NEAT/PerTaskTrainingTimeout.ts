/**
 * Tests for the per-training-task wall-clock cap derivation (Issue #3053).
 *
 * `computePerTaskTimeoutMinutes` is pure, so these tests assert directly on
 * the clamped minute budget — no elapsed-time measurement (#2888 policy).
 */

import { assertEquals } from "@std/assert";
import {
  computeEffectiveTrainingBudgetMs,
  computePerTaskTimeoutMinutes,
  isPastTrainingDeadline,
  isTrainingBudgetTooSmall,
  MIN_TRAINING_BUDGET_MS,
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

// ============================================================================
// Issue #3166: reject implausibly small (sub-second) training budgets
// ============================================================================

Deno.test("computeEffectiveTrainingBudgetMs - remaining budget from an absolute timeout", () => {
  const now = 1_000_000;
  assertEquals(computeEffectiveTrainingBudgetMs(now, now + 5_000), 5_000);
  // Deadline already passed → negative remaining budget.
  assertEquals(computeEffectiveTrainingBudgetMs(now, now - 250), -250);
});

Deno.test("computeEffectiveTrainingBudgetMs - no timeout yields an infinite budget", () => {
  const now = 1_000_000;
  assertEquals(
    computeEffectiveTrainingBudgetMs(now, 0),
    Number.POSITIVE_INFINITY,
  );
  assertEquals(
    computeEffectiveTrainingBudgetMs(now, -1),
    Number.POSITIVE_INFINITY,
  );
});

Deno.test("isTrainingBudgetTooSmall - flags sub-second and non-positive budgets", () => {
  // The GRQ-16 millisecond budgets are all rejected.
  assertEquals(isTrainingBudgetTooSmall(16), true);
  assertEquals(isTrainingBudgetTooSmall(93), true);
  assertEquals(isTrainingBudgetTooSmall(0), true);
  assertEquals(isTrainingBudgetTooSmall(-250), true);
  // Just under and just over the default floor.
  assertEquals(isTrainingBudgetTooSmall(MIN_TRAINING_BUDGET_MS - 1), true);
  assertEquals(isTrainingBudgetTooSmall(MIN_TRAINING_BUDGET_MS), false);
});

Deno.test("isTrainingBudgetTooSmall - a plausible or unbounded budget is accepted", () => {
  assertEquals(isTrainingBudgetTooSmall(60_000), false);
  // No timeout configured (infinite budget) is never too small.
  assertEquals(isTrainingBudgetTooSmall(Number.POSITIVE_INFINITY), false);
});

Deno.test("isTrainingBudgetTooSmall - honours a custom minimum", () => {
  assertEquals(isTrainingBudgetTooSmall(1_500, 2_000), true);
  assertEquals(isTrainingBudgetTooSmall(2_500, 2_000), false);
});
