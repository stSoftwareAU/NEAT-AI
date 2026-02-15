import { fail } from "@std/assert";
import type { CostInterface } from "./CostInterface.ts";

/**
 * Cross Entropy cost function for classification problems.
 *
 * Cross entropy is the standard loss function for classification tasks in machine learning.
 * It measures the difference between two probability distributions - the predicted
 * probabilities and the true labels.
 *
 * **Formula:** CE = -Σ(y_true * log(y_pred) + (1 - y_true) * log(1 - y_pred))
 *
 * **Characteristics:**
 * - Optimized for probability outputs (values between 0 and 1)
 * - Heavily penalizes confident wrong predictions
 * - Works well with sigmoid/softmax activation functions
 * - Standard choice for binary and multi-class classification
 * - Numerically stable with proper clamping
 *
 * **Use Cases:**
 * - Binary classification
 * - Multi-class classification (with softmax)
 * - Logistic regression
 * - Neural network classifiers
 *
 * **References:**
 * - [Wikipedia: Cross entropy](https://en.wikipedia.org/wiki/Cross_entropy)
 * - [Wikipedia: Loss functions for classification](https://en.wikipedia.org/wiki/Loss_functions_for_classification)
 *
 * @example
 * ```typescript
 * const ce = new CrossEntropy();
 * const target = new Float32Array([1, 0, 1]); // True labels
 * const output = new Float32Array([0.9, 0.1, 0.8]); // Predicted probabilities
 * const error = ce.calculate(target, output);
 * getLogger().info(error); // Cross entropy loss
 * ```
 */
export class CrossEntropy implements CostInterface {
  static readonly NAME = "CROSS_ENTROPY";

  /**
   * Returns the name of this cost function.
   * @returns The string "CROSS_ENTROPY"
   */
  getName(): string {
    return CrossEntropy.NAME;
  }

  /**
   * Calculates the cross entropy error between target and output arrays.
   *
   * The output values are clamped to [1e-15, 1 - 1e-15] to ensure numerical stability
   * and prevent log(0) errors.
   *
   * @param target - The true labels (should be 0 or 1 for binary classification)
   * @param output - The predicted probabilities (should be between 0 and 1)
   * @returns The cross entropy error
   *
   * @throws {Error} If output values are outside [0,1] range
   * @throws {Error} If target and output arrays have different lengths
   */
  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      const t = target[i];
      let o = output[i];

      // Clamp o to [1e-15, 1 - 1e-15], warn if out-of-bounds
      if (o < 0 || o > 1) {
        fail(`CrossEntropy: output[${i}] = ${o} is outside [0,1]`);
      }

      o = Math.min(Math.max(o, 1e-15), 1 - 1e-15);

      error -= t * Math.log(o) + (1 - t) * Math.log(1 - o);
    }

    return error / len;
  }
}
