import type { CostInterface } from "./CostInterface.ts";

/**
 * Mean Absolute Percentage Error (MAPE) cost function.
 *
 * MAPE measures the average percentage difference between predicted and actual values.
 * It expresses the error as a percentage, making it useful for comparing errors
 * across different scales.
 *
 * **Formula:** MAPE = (1/n) * Σ|(y_pred - y_true) / y_true| * 100%
 *
 * **Characteristics:**
 * - Scale-independent (expressed as percentage)
 * - Useful for comparing errors across different datasets
 * - Penalizes relative errors rather than absolute errors
 * - Sensitive to small actual values (division by small numbers)
 * - Not symmetric (different error for over/under prediction)
 *
 * **Use Cases:**
 * - Business forecasting
 * - Sales prediction
 * - Demand forecasting
 * - Any scenario where relative accuracy is more important than absolute accuracy
 *
 * **References:**
 * - [Wikipedia: Mean absolute percentage error](https://en.wikipedia.org/wiki/Mean_absolute_percentage_error)
 * - [Wikipedia: Forecasting](https://en.wikipedia.org/wiki/Forecasting)
 *
 * @example
 * ```typescript
 * const mape = new MAPE();
 * const target = new Float32Array([100, 200, 300]);
 * const output = new Float32Array([95, 210, 285]);
 * const error = mape.calculate(target, output);
 * getLogger().info(error); // Mean absolute percentage error
 * ```
 */
export class MAPE implements CostInterface {
  static readonly NAME = "MAPE";

  /**
   * Returns the name of this cost function.
   * @returns The string "MAPE"
   */
  getName(): string {
    return MAPE.NAME;
  }

  /**
   * Calculates the mean absolute percentage error between target and output arrays.
   *
   * The calculation uses a small epsilon (1e-15) to prevent division by zero
   * when target values are very close to zero.
   *
   * @param target - The true/expected values (should not be zero)
   * @param output - The predicted values
   * @returns The mean absolute percentage error (always non-negative)
   *
   * @throws {Error} If target and output arrays have different lengths
   * @throws {Error} If target values are zero or negative
   */
  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      const t = target[i];
      const o = output[i];
      error += Math.abs((o - t) / Math.max(t, 1e-15));
    }

    return error / len;
  }
}
