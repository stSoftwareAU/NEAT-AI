import type { CostInterface } from "./CostInterface.ts";

/**
 * Hinge Loss cost function for binary classification.
 *
 * Hinge loss is commonly used in Support Vector Machines (SVMs) and other
 * binary classification algorithms. It penalizes predictions that are on the
 * wrong side of the decision boundary.
 *
 * **Formula:** Hinge = max(0, 1 - y_true * y_pred)
 *
 * **Characteristics:**
 * - Designed for binary classification with labels {-1, 1} or {0, 1}
 * - Zero loss when prediction is correct and confident
 * - Linear penalty for incorrect predictions
 * - Encourages margin maximization
 * - Non-differentiable at the hinge point
 *
 * **Use Cases:**
 * - Support Vector Machines (SVMs)
 * - Binary classification problems
 * - Margin-based learning algorithms
 * - When you want to maximize the margin between classes
 *
 * **References:**
 * - [Wikipedia: Hinge loss](https://en.wikipedia.org/wiki/Hinge_loss)
 * - [Wikipedia: Support vector machine](https://en.wikipedia.org/wiki/Support_vector_machine)
 *
 * @example
 * ```typescript
 * const hinge = new HINGE();
 * const target = new Float32Array([1, -1, 1]); // True labels
 * const output = new Float32Array([0.8, -0.3, 1.2]); // Predictions
 * const error = hinge.calculate(target, output);
 * console.log(error); // Hinge loss
 * ```
 */
export class HINGE implements CostInterface {
  static readonly NAME = "HINGE";

  /**
   * Returns the name of this cost function.
   * @returns The string "HINGE"
   */
  getName(): string {
    return HINGE.NAME;
  }

  /**
   * Calculates the hinge loss between target and output arrays.
   *
   * For binary classification, target values should typically be {-1, 1} or {0, 1},
   * and output values can be any real number (raw scores before thresholding).
   *
   * @param target - The true labels (typically -1/1 or 0/1)
   * @param output - The predicted scores (can be any real number)
   * @returns The hinge loss (always non-negative)
   *
   * @throws {Error} If target and output arrays have different lengths
   */
  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    for (let i = output.length; i--;) {
      error += Math.max(0, 1 - target[i] * output[i]);
    }

    return error;
  }
}
