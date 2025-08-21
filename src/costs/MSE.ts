import type { CostInterface } from "./CostInterface.ts";

/**
 * Mean Squared Error (MSE) cost function.
 *
 * MSE is one of the most widely used loss functions in machine learning and statistics.
 * It measures the average squared difference between predicted and actual values.
 *
 * **Formula:** MSE = (1/n) * Σ(y_true - y_pred)²
 *
 * **Characteristics:**
 * - Penalizes larger errors more heavily due to squaring
 * - Differentiable everywhere, making it suitable for gradient-based optimization
 * - Sensitive to outliers due to the squared term
 * - Commonly used for regression problems
 *
 * **Use Cases:**
 * - Linear regression
 * - Neural network regression
 * - Time series forecasting
 * - Any continuous value prediction task
 *
 * **References:**
 * - [Wikipedia: Mean squared error](https://en.wikipedia.org/wiki/Mean_squared_error)
 * - [Wikipedia: Loss function](https://en.wikipedia.org/wiki/Loss_function)
 *
 * @example
 * ```typescript
 * const mse = new MSE();
 * const target = new Float32Array([1.0, 2.0, 3.0]);
 * const output = new Float32Array([0.9, 2.1, 2.8]);
 * const error = mse.calculate(target, output);
 * console.log(error); // Average squared error
 * ```
 */
export class MSE implements CostInterface {
  static readonly NAME = "MSE";

  /**
   * Returns the name of this cost function.
   * @returns The string "MSE"
   */
  getName(): string {
    return MSE.NAME;
  }

  /**
   * Calculates the mean squared error between target and output arrays.
   *
   * @param target - The true/expected values
   * @param output - The predicted values
   * @returns The mean squared error (always non-negative)
   *
   * @throws {Error} If target and output arrays have different lengths
   */
  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    const len = output.length;
    const invLen = 1 / len;

    for (let i = len; i--;) {
      const diff = target[i] - output[i];
      error += diff * diff;
    }

    return error * invLen;
  }
}
