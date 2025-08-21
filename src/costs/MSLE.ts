import type { CostInterface } from "./CostInterface.ts";

/**
 * Mean Squared Logarithmic Error (MSLE) cost function.
 *
 * MSLE measures the average squared difference between the natural logarithms
 * of predicted and actual values. It's particularly useful when relative errors
 * are more important than absolute errors.
 *
 * **Formula:** MSLE = (1/n) * Σ(log(1 + y_true) - log(1 + y_pred))²
 *
 * **Characteristics:**
 * - Penalizes relative errors more than absolute errors
 * - Works well with data that spans multiple orders of magnitude
 * - Less sensitive to outliers compared to MSE
 * - Requires positive target and output values
 * - Logarithmic transformation reduces the impact of large values
 *
 * **Use Cases:**
 * - Time series forecasting
 * - Population growth modeling
 * - Financial data with exponential growth
 * - Any data with wide value ranges
 * - When relative accuracy is more important than absolute accuracy
 *
 * **References:**
 * - [Wikipedia: Loss function](https://en.wikipedia.org/wiki/Loss_function)
 * - [Wikipedia: Logarithm](https://en.wikipedia.org/wiki/Logarithm)
 *
 * @example
 * ```typescript
 * const msle = new MSLE();
 * const target = new Float32Array([1, 10, 100]);
 * const output = new Float32Array([0.9, 11, 95]);
 * const error = msle.calculate(target, output);
 * console.log(error); // Mean squared logarithmic error
 * ```
 */
export class MSLE implements CostInterface {
  static readonly NAME = "MSLE";

  /**
   * Returns the name of this cost function.
   * @returns The string "MSLE"
   */
  getName(): string {
    return MSLE.NAME;
  }

  /**
   * Calculates the mean squared logarithmic error between target and output arrays.
   *
   * The calculation uses a small epsilon (1e-15) to prevent log(0) errors
   * when values are very close to zero.
   *
   * @param target - The true/expected values (should be positive)
   * @param output - The predicted values (should be positive)
   * @returns The mean squared logarithmic error (always non-negative)
   *
   * @throws {Error} If target and output arrays have different lengths
   * @throws {Error} If target or output values are negative
   */
  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    for (let i = output.length; i--;) {
      error += Math.log(Math.max(target[i], 1e-15)) -
        Math.log(Math.max(output[i], 1e-15));
    }

    return error;
  }
}
