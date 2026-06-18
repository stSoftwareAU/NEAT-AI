/**
 * PerTaskTrainingTimeout.ts — per-training-task wall-clock cap derivation.
 *
 * Issue #3053: A single training task was previously allowed to run for the
 * entire remaining run budget (`endTimeTS - now`), so a stuck task could burn
 * 10+ minutes before timing out. This helper clamps the per-task budget to a
 * small configured cap (`trainingTaskTimeoutMinutes`) so no individual task
 * can consume the whole remaining run.
 *
 * Pure so it can be unit-tested without elapsed-time assertions (#2888 policy).
 */

/**
 * Derives the wall-clock budget (in minutes) for a single training task.
 *
 * @param remainingRunMinutes minutes left in the overall run budget. A
 *   negative value is the existing "no remaining budget" sentinel (-1) and is
 *   propagated unchanged; `0` means the run has no overall deadline.
 * @param taskCapMinutes the configured per-task cap. `0`/`undefined` disables
 *   the cap, preserving the pre-#3053 behaviour of using the full remaining
 *   run budget.
 * @returns the per-task budget in minutes — `min(remainingRunMinutes, cap)`
 *   when a cap is configured, with a 1-minute floor so the worker can make
 *   forward progress before the timeout trips.
 */
export function computePerTaskTimeoutMinutes(
  remainingRunMinutes: number,
  taskCapMinutes: number | undefined,
): number {
  const cap = taskCapMinutes && taskCapMinutes > 0
    ? Math.max(1, Math.ceil(taskCapMinutes))
    : 0;

  // Negative sentinel (-1): no remaining run budget — never widen it.
  if (remainingRunMinutes < 0) {
    return remainingRunMinutes;
  }

  // No overall run deadline: apply the cap when configured, otherwise none.
  if (remainingRunMinutes === 0) {
    return cap;
  }

  // Positive remaining: clamp to the smaller of the remaining run and the cap.
  return cap > 0 ? Math.min(remainingRunMinutes, cap) : remainingRunMinutes;
}
