/**
 * Unit tests for the cost-aggregation helpers (Issue #3853).
 *
 * The expected values mirror the doctest in the native scorer's
 * `CostKind::finalise_mean` — `MSE.finalise_mean(8.0, 2) == 4.0` and
 * `RMSE.finalise_mean(8.0, 2) == 2.0` — so the two engines' finalisation rules
 * are pinned to the same numbers on both sides of the boundary.
 */
import { assertEquals, assertStrictEquals } from "@std/assert";
import { Costs } from "../../mod.ts";
import type { CostInterface } from "@costs/CostInterface.ts";
import {
  accumulationCostFor,
  finaliseCostMean,
  isRootOfMeanCost,
} from "@costs/CostAggregation.ts";

class CustomCost implements CostInterface {
  getName(): string {
    return "CUSTOM_TEST_COST";
  }
  calculate(target: Float32Array, output: Float32Array): number {
    return Math.abs(target[0] - output[0]);
  }
}

Deno.test("isRootOfMeanCost - only RMSE is aggregated under a root", () => {
  assertEquals(isRootOfMeanCost("RMSE"), true);
  for (
    const name of ["MSE", "MAE", "MAPE", "MSLE", "HINGE", "CROSS_ENTROPY"]
  ) {
    assertEquals(isRootOfMeanCost(name), false, `${name} is a plain mean`);
  }
  assertEquals(isRootOfMeanCost("CUSTOM_TEST_COST"), false);
  assertEquals(isRootOfMeanCost(""), false);
});

Deno.test("accumulationCostFor - RMSE accumulates with MSE", () => {
  const accumulator = accumulationCostFor(Costs.find("RMSE"));
  assertEquals(accumulator.getName(), "MSE");

  // The accumulator is the squared error of one record, not its root.
  const target = new Float32Array([1, 1]);
  const output = new Float32Array([0, 2]);
  assertEquals(accumulator.calculate(target, output), 1);
});

Deno.test("accumulationCostFor - every other cost accumulates with itself", () => {
  for (const name of ["MSE", "MAE", "MAPE", "MSLE", "HINGE", "CROSS_ENTROPY"]) {
    const cost = Costs.find(name);
    assertStrictEquals(accumulationCostFor(cost), cost, name);
  }
  const custom = new CustomCost();
  assertStrictEquals(accumulationCostFor(custom), custom);
});

Deno.test("finaliseCostMean - mean-style costs divide, RMSE roots the mean", () => {
  assertEquals(finaliseCostMean("MSE", 8, 2), 4);
  assertEquals(finaliseCostMean("RMSE", 8, 2), 2);
  assertEquals(finaliseCostMean("MAE", 9, 3), 3);
  assertEquals(finaliseCostMean("CUSTOM_TEST_COST", 9, 3), 3);
});

Deno.test("finaliseCostMean - edge cases: zero error and a single record", () => {
  assertEquals(finaliseCostMean("RMSE", 0, 5), 0);
  assertEquals(finaliseCostMean("MSE", 0, 5), 0);
  assertEquals(finaliseCostMean("RMSE", 0.25, 1), 0.5);
  assertEquals(finaliseCostMean("MSE", 0.25, 1), 0.25);
});
