/**
 * Cost-aware `targetError` early-stop and champion-selection helpers used by
 * `evolveDir` (Issue #2787).
 *
 * Before this module: `error <= targetError` was applied on a fixed scale
 * regardless of cost. A `0.1` `CATEGORICAL_ERROR` (≈90% accuracy) and a
 * `0.1` `MSE` (an unbounded regression metric) were stopped at the same
 * threshold — mis-calibrated.
 *
 * After this module: the threshold is interpreted in the cost's natural
 * range using the descriptor from {@link costNameToTaskDescriptor}.
 * Unit-range costs (CATEGORICAL_ERROR, CROSS_ENTROPY, BINARY_CROSS_ENTROPY)
 * clamp the threshold into `[0, 1]`. Positive-range costs (MAPE, MSLE)
 * floor it at `0`. Unbounded costs (MSE, MAE) accept any threshold.
 *
 * **Regression guard:** custom JS costs (`OTHER`) bypass calibration and
 * fall back to the legacy `error <= targetError` / `score > bestScore`
 * comparators verbatim.
 */

import { costNameToTaskDescriptor } from "@costs/CostDescriptor.ts";

/**
 * Returns a `targetError` value clamped into the cost's natural range. For
 * unknown/custom costs the input is returned unchanged (legacy behaviour).
 */
export function calibrateTargetError(
  targetError: number,
  costName: string | undefined,
): number {
  const descriptor = costNameToTaskDescriptor(costName);
  if (descriptor.costName === "OTHER") {
    // Regression guard: do not touch thresholds for custom costs.
    return targetError;
  }
  switch (descriptor.range) {
    case "unit":
      // Error is in `[0, 1]`. Clamp the threshold so a too-large user input
      // does not trivially stop the run, and a negative input does not
      // disable early-stop.
      return Math.max(0, Math.min(1, targetError));
    case "signed_unit":
      // HINGE (margin) is bounded below by 0; treat negative as 0. Allow
      // any positive threshold — hinge can exceed 1 in practice when the
      // margin is violated by a wide margin.
      return Math.max(0, targetError);
    case "positive":
      return Math.max(0, targetError);
    case "unbounded":
      return targetError;
  }
}

/**
 * Returns `true` iff `error` meets the cost-aware early-stop threshold for
 * `costName`. For OTHER (custom JS cost), behaves as the legacy comparator
 * `error <= targetError`.
 *
 * For built-in costs, an out-of-range threshold (e.g. `targetError = 1.5`
 * for the unit-range `CATEGORICAL_ERROR`) is treated as "no early-stop on
 * this criterion" — the run defers to `iterations` / `timeoutMinutes`. A
 * fat-fingered threshold should not silently halt the run on the very
 * first generation.
 */
export function shouldEarlyStop(
  error: number,
  targetError: number,
  costName: string | undefined,
): boolean {
  const descriptor = costNameToTaskDescriptor(costName);
  if (descriptor.costName === "OTHER") {
    return error <= targetError; // Regression guard for custom JS costs.
  }
  switch (descriptor.range) {
    case "unit":
      if (targetError < 0 || targetError > 1) return false;
      break;
    case "signed_unit":
    case "positive":
      if (targetError < 0) return false;
      break;
    case "unbounded":
      break;
  }
  return error <= targetError;
}

/**
 * Returns `true` iff `candidateScore` should replace `bestScore` as the
 * champion under `costName`. Currently a strict `>` comparison for every
 * cost (matches the legacy behaviour today) and NaN-safe: a NaN candidate
 * never wins, and any finite candidate beats a NaN incumbent. Routing
 * champion comparison through this helper gives future cost-specific
 * tie-breaks (e.g. continuous companion CE for CATEGORICAL_ERROR) a single
 * seam to extend without further touching `evolveDir`.
 */
export function isBetterChampion(
  candidateScore: number,
  bestScore: number,
  _costName: string | undefined,
): boolean {
  if (Number.isNaN(candidateScore)) return false;
  if (Number.isNaN(bestScore)) return true;
  return candidateScore > bestScore;
}
