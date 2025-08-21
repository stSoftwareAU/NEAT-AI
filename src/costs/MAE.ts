import type { CostInterface } from "./CostInterface.ts";

/**
 * Mean Absolute Error (MAE) cost function.
 *
 * MAE measures the average absolute difference between predicted and actual values.
 * Unlike MSE, it treats all errors linearly and is less sensitive to outliers.
 *
 * **Formula:** MAE = (1/n) * Σ|y_true - y_pred|
 *
 * **Characteristics:**
 * - Linear penalty for errors (no squaring)
 * - More robust to outliers compared to MSE
 * - Less sensitive to large errors
 * - Differentiable everywhere except at zero
 * - Often used when outliers are a concern
 *
 * **Use Cases:**
 * - Regression problems with outliers
 * - Time series forecasting
 * - Financial modeling
 * - Any regression task where robustness is important
 *
 * **References:**
 * - [Wikipedia: Mean absolute error](https://en.wikipedia.org/wiki/Mean_absolute_error)
 * - [Wikipedia: Loss function](https://en.wikipedia.org/wiki/Loss_function)
 *
 * @example
 * ```typescript
 * const mae = new MAE();
 * const target = new Float32Array([1.0, 2.0, 3.0]);
 * const output = new Float32Array([0.9, 2.1, 2.8]);
 * const error = mae.calculate(target, output);
 * console.log(error); // Average absolute error
 * ```
 */
export class MAE implements CostInterface {
  static readonly NAME = "MAE";

  /**
   * Returns the name of this cost function.
   * @returns The string "MAE"
   */
  getName(): string {
    return MAE.NAME;
  }

  /**
   * Calculates the mean absolute error between target and output arrays.
   *
   * @param target - The true/expected values
   * @param output - The predicted values
   * @returns The mean absolute error (always non-negative)
   *
   * @throws {Error} If target and output arrays have different lengths
   */
  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      error += Math.abs(target[i] - output[i]);
    }

    return error / len;
  }
}
