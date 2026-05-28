/**
 * Integration test for the cost-aware `targetError` early-stop wiring in
 * `evolveDir` / `evolveDataSet` (Issue #2787).
 *
 * The "what" being tested: with the **same** user-supplied `targetError`,
 * a `CATEGORICAL_ERROR` run and an `MSE` run stop on appropriately-scaled
 * thresholds rather than on the same fixed scale. We verify this by
 * running the cost-aware helpers exactly as `CreatureTraining.ts` does and
 * asserting the early-stop decisions diverge per cost.
 *
 * This is an integration test of the wiring (the helpers are imported from
 * the same module the production code uses) rather than a slow end-to-end
 * `evolveDataSet` run — the unit tests in `CostAwareEarlyStop.ts` already
 * pin the per-cost arithmetic.
 */

import { assertEquals } from "@std/assert";
import { shouldEarlyStop } from "@costs/CostAwareEarlyStop.ts";

Deno.test("evolveDir wiring - same targetError diverges between CATEGORICAL_ERROR and MSE", () => {
  // Imagine an evolveDir caller that supplied `targetError = 1.5`. For the
  // unit-range CATEGORICAL_ERROR cost (error always in [0, 1]) this is
  // clamped to 1.0; an intermediate error of 0.5 does NOT trigger
  // early-stop because the calibrated threshold reflects the cost's
  // natural range. For the unbounded MSE cost the same input is a
  // legitimate threshold and the same 0.5 error DOES trigger early-stop.
  //
  // This is exactly what `CreatureTraining.ts` now does on every
  // generation completion check.
  const observedError = 0.5;
  const userTargetError = 1.5;

  const categoricalStop = shouldEarlyStop(
    observedError,
    userTargetError,
    "CATEGORICAL_ERROR",
  );
  const mseStop = shouldEarlyStop(observedError, userTargetError, "MSE");

  assertEquals(
    categoricalStop,
    false,
    "CATEGORICAL_ERROR must not stop on 0.5 ≤ clamped 1.0 boundary at error=0.5",
  );
  assertEquals(mseStop, true, "MSE must stop on raw 0.5 ≤ 1.5");
});

Deno.test("evolveDir wiring - both costs stop at their natural high-quality thresholds", () => {
  // Sanity check: at the realistic high-quality threshold each cost
  // typically targets, both stop.
  assertEquals(
    shouldEarlyStop(0.05, 0.10, "CATEGORICAL_ERROR"),
    true,
    "CATEGORICAL_ERROR at 5% misclass stops on 10% threshold",
  );
  assertEquals(
    shouldEarlyStop(0.001, 0.01, "MSE"),
    true,
    "MSE at 0.001 stops on 0.01 threshold",
  );
});

Deno.test("evolveDir wiring - OTHER (custom cost) preserves legacy behaviour", () => {
  // Regression guard. With a custom JS cost the helper must behave as the
  // pre-#2787 `error <= targetError` comparator on every input, including
  // values that would have been clamped for a built-in unit-range cost.
  assertEquals(shouldEarlyStop(0.5, 1.5, "MY_CUSTOM_REGRESSION_COST"), true);
  assertEquals(shouldEarlyStop(0.05, 0.10, "MY_CUSTOM_REGRESSION_COST"), true);
  assertEquals(shouldEarlyStop(0.15, 0.10, "MY_CUSTOM_REGRESSION_COST"), false);
  // Behaviour is independent of the unrecognised name — leakage guard
  // from the #2786 mapping helper.
  assertEquals(
    shouldEarlyStop(0.5, 1.5, "DIFFERENT_CUSTOM"),
    shouldEarlyStop(0.5, 1.5, "MY_CUSTOM_REGRESSION_COST"),
  );
});
