/**
 * Unit tests for the cost-aware `targetError` early-stop / champion comparison
 * helpers used by `evolveDir`. Issue #2787.
 *
 * The point of these helpers is that a `0.1` `CROSS_ENTROPY` (a unit-range
 * classification metric) and a `0.1` `MSE` (an unbounded
 * regression metric) are no longer treated on the same fixed scale. The
 * helpers consult the cost descriptor (Issue #2786) and apply the threshold
 * in the cost's natural range.
 *
 * For custom JS costs (`OTHER`), the helpers fall back to the legacy
 * `error <= targetError` / `score > bestScore` behaviour as a regression
 * guard.
 */

import { assertEquals } from "@std/assert";
import {
  calibrateTargetError,
  isBetterChampion,
  shouldEarlyStop,
} from "@costs/CostAwareEarlyStop.ts";

Deno.test("shouldEarlyStop - CROSS_ENTROPY stops on its unit scale", () => {
  // Unit-range cost: stop when error meets the in-range threshold.
  assertEquals(shouldEarlyStop(0.10, 0.10, "CROSS_ENTROPY"), true);
  assertEquals(shouldEarlyStop(0.11, 0.10, "CROSS_ENTROPY"), false);
});

Deno.test("shouldEarlyStop - unit-range targetError above 1.0 defers to other stop criteria", () => {
  // CROSS_ENTROPY is bounded in [0, 1]. A targetError of 2.0 is
  // nonsensical on the unit scale and the cost-aware helper refuses to
  // stop on it — the run defers to `iterations` / `timeoutMinutes` rather
  // than halting on a fat-fingered threshold.
  assertEquals(shouldEarlyStop(0.5, 2.0, "CROSS_ENTROPY"), false);
  assertEquals(shouldEarlyStop(1.0, 2.0, "CROSS_ENTROPY"), false);
  // Within-range thresholds still work normally.
  assertEquals(shouldEarlyStop(0.5, 0.5, "CROSS_ENTROPY"), true);
  assertEquals(shouldEarlyStop(0.5, 0.4, "CROSS_ENTROPY"), false);
});

Deno.test("shouldEarlyStop - MSE is unbounded; threshold passes through", () => {
  // MSE can exceed 1.0. A targetError of 2.0 means "stop when MSE <= 2.0".
  assertEquals(shouldEarlyStop(2.5, 2.0, "MSE"), false);
  assertEquals(shouldEarlyStop(2.0, 2.0, "MSE"), true);
  assertEquals(shouldEarlyStop(0.001, 2.0, "MSE"), true);
});

Deno.test("shouldEarlyStop - calibrated thresholds: CROSS_ENTROPY vs MSE at targetError=1.5", () => {
  // Same user-supplied `targetError = 1.5`, different cost-aware behaviour.
  // For CROSS_ENTROPY (unit), 1.5 is clamped to 1.0, so error=0.5
  // does NOT trigger early stop.
  assertEquals(shouldEarlyStop(0.5, 1.5, "CROSS_ENTROPY"), false);
  // For MSE (unbounded), 1.5 is a legitimate threshold and error=0.5
  // DOES trigger early stop.
  assertEquals(shouldEarlyStop(0.5, 1.5, "MSE"), true);
});

Deno.test("shouldEarlyStop - HINGE (signed_unit margin) accepts any positive threshold", () => {
  assertEquals(shouldEarlyStop(0.0, 0.1, "HINGE"), true);
  assertEquals(shouldEarlyStop(0.2, 0.1, "HINGE"), false);
});

Deno.test("shouldEarlyStop - positive-range costs reject negative thresholds", () => {
  // MAPE / MSLE error >= 0; a negative threshold means "never stop", not
  // "always stop".
  assertEquals(shouldEarlyStop(0.0, -1, "MAPE"), false);
  assertEquals(shouldEarlyStop(0.0, 0, "MAPE"), true);
});

Deno.test("shouldEarlyStop - OTHER (custom JS cost) preserves legacy behaviour", () => {
  // Regression guard from Issue #2787 acceptance criteria.
  assertEquals(shouldEarlyStop(0.05, 0.1, "MY_CUSTOM_COST"), true);
  assertEquals(shouldEarlyStop(0.15, 0.1, "MY_CUSTOM_COST"), false);
  // No clamping: a targetError of 2.0 on an unknown cost just acts as the
  // raw comparator.
  assertEquals(shouldEarlyStop(1.5, 2.0, "MY_CUSTOM_COST"), true);
  // undefined cost name behaves like a custom cost (legacy behaviour).
  assertEquals(shouldEarlyStop(0.05, 0.1, undefined), true);
});

Deno.test("calibrateTargetError - clamps unit-range thresholds", () => {
  assertEquals(calibrateTargetError(0.5, "CROSS_ENTROPY"), 0.5);
  assertEquals(calibrateTargetError(2.0, "CROSS_ENTROPY"), 1.0);
  assertEquals(calibrateTargetError(-0.5, "CROSS_ENTROPY"), 0.0);
});

Deno.test("calibrateTargetError - leaves unbounded thresholds unchanged", () => {
  assertEquals(calibrateTargetError(2.0, "MSE"), 2.0);
  assertEquals(calibrateTargetError(0.001, "MSE"), 0.001);
});

Deno.test("calibrateTargetError - positive-range floors negative thresholds at 0", () => {
  assertEquals(calibrateTargetError(-1, "MAPE"), 0);
  assertEquals(calibrateTargetError(0.5, "MAPE"), 0.5);
});

Deno.test("calibrateTargetError - OTHER passes through unchanged", () => {
  assertEquals(calibrateTargetError(2.0, "MY_CUSTOM"), 2.0);
  assertEquals(calibrateTargetError(-1, "MY_CUSTOM"), -1);
});

Deno.test("isBetterChampion - higher score wins for all costs", () => {
  // Champion comparison is "score > bestScore" today. The cost-aware
  // wrapper preserves this for every cost (including OTHER) so existing
  // runs do not regress, but routes the comparison through the helper so
  // future cost-specific tie-breaks (e.g. companion CE for CROSS_ENTROPY)
  // have a single seam to extend.
  assertEquals(isBetterChampion(0.9, 0.8, "MSE"), true);
  assertEquals(isBetterChampion(0.8, 0.9, "MSE"), false);
  assertEquals(isBetterChampion(0.9, 0.9, "MSE"), false);
  assertEquals(isBetterChampion(0.9, 0.8, "CROSS_ENTROPY"), true);
  assertEquals(isBetterChampion(0.9, 0.8, "MY_CUSTOM"), true);
  assertEquals(isBetterChampion(0.9, 0.8, undefined), true);
});

Deno.test("isBetterChampion - NaN never wins", () => {
  assertEquals(isBetterChampion(Number.NaN, 0.5, "MSE"), false);
  assertEquals(isBetterChampion(0.5, Number.NaN, "MSE"), true);
});
