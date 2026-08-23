/**
 * How a per-record cost is aggregated into the dataset-level error
 * (Issue #3853).
 *
 * Nearly every built-in cost is a **mean**: score each record, sum, divide by
 * the record count. `RMSE` is not. It is the root of the mean squared error, so
 * it accumulates the **MSE squared-error sum** and takes the root once, at
 * finalisation. Accumulating the per-record roots and averaging them instead
 * yields `mean(sqrt(...))`, which by Jensen's inequality is strictly smaller
 * than `sqrt(mean(...))` whenever the per-record errors differ — a silently
 * different number from the one the documented formula and the native
 * `rust_scorer` (`CostKind::finalise_mean`) report.
 *
 * These two helpers are the TypeScript counterpart of that Rust finalisation:
 * pick the accumulation cost with {@link accumulationCostFor}, then close the
 * sum with {@link finaliseCostMean}. Keeping both sides of the decision in one
 * module is what stops an accumulation site from rooting per record again.
 */
import type { CostInterface } from "@costs/CostInterface.ts";
import { MSE } from "@costs/MSE.ts";
import { RMSE } from "@costs/RMSE.ts";

const MSE_FOR_ACCUMULATION = new MSE();

/**
 * True when `costName` reports the root of the mean rather than a plain mean,
 * and therefore may not be accumulated per record.
 */
export function isRootOfMeanCost(costName: string): boolean {
  return costName === RMSE.NAME;
}

/**
 * The cost to accumulate with for a configured cost.
 *
 * Returns `cost` unchanged for every mean-style cost. For `RMSE` it returns
 * `MSE`, because RMSE's accumulator is the squared-error sum — the root belongs
 * in {@link finaliseCostMean}, not in the per-record step.
 */
export function accumulationCostFor(cost: CostInterface): CostInterface {
  return isRootOfMeanCost(cost.getName()) ? MSE_FOR_ACCUMULATION : cost;
}

/**
 * Close an accumulated per-record sum into the dataset-level error.
 *
 * Divides by `recordCount`, then applies the root for root-of-mean costs.
 * Mirrors `CostKind::finalise_mean` in the native scorer so both engines report
 * the same number for the same creature and dataset.
 *
 * @param costName - The **configured** cost name (not the accumulation cost).
 * @param errorSum - Sum of the per-record accumulation-cost values.
 * @param recordCount - Number of records accumulated; must be non-zero.
 */
export function finaliseCostMean(
  costName: string,
  errorSum: number,
  recordCount: number,
): number {
  const mean = errorSum / recordCount;
  return isRootOfMeanCost(costName) ? Math.sqrt(mean) : mean;
}
