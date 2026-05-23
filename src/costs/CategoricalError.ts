import type { CostInterface } from "@costs/CostInterface.ts";

/**
 * Categorical (argmax) error cost function for multi-class one-hot targets.
 *
 * Standard regression-style costs such as {@link module:src/costs/MSE} measure
 * the average squared distance between each output and its target. For
 * **one-hot encoded multi-class** problems this can be badly misleading: a
 * constant or near-constant classifier that always emits one output near `1`
 * and the rest near `0` reaches a trivial MSE floor (~`0.1` for ten balanced
 * classes) **without learning any class structure**. The recorded `error`
 * looks good while real argmax classification accuracy is stuck at chance.
 *
 * `CategoricalError` closes that gap by measuring the metric users actually
 * care about: the **misclassification rate**. For each record it compares the
 * index of the largest target value (the true class) with the index of the
 * largest output value (the predicted class) and contributes `0` for a correct
 * prediction or `1` for an incorrect one. Averaged across a dataset by the
 * scorer, the resulting `error` equals `1 - accuracy`, so:
 *
 * - `error = 0.0` → 100% argmax accuracy.
 * - `error = 0.9` → 10% accuracy (chance for ten classes).
 *
 * Because `score = 1 - error - penalties`, a chance-level classifier now
 * reports a low score (~`0.1`) instead of a misleadingly high one (~`0.9`),
 * and a `targetError` stop condition reflects the user's real task.
 *
 * **Characteristics:**
 * - Reports the true misclassification rate for one-hot multi-class targets.
 * - Range is `[0, 1]`; lower is better, exactly like the MSE-based costs.
 * - **Non-differentiable** — argmax has no useful gradient. This cost is
 *   intended for **scoring, champion selection and early-stop** (`targetError`),
 *   not as a backpropagation loss. Gradient descent in NEAT-AI derives its
 *   gradients independently of `costName`, so selecting this cost still trains
 *   normally while reporting a task-aligned error.
 *
 * **Use Cases:**
 * - Multi-class classification with one-hot targets (e.g. MNIST digits).
 * - Any task where argmax accuracy is the real objective and MSE/score can
 *   decouple from it.
 *
 * **Limitations:**
 * - Requires at least two outputs to be meaningful. With a single output the
 *   argmax is always index `0`, so every record is counted "correct" and the
 *   error is always `0`. Use a probability-threshold metric for binary tasks.
 * - Ties (multiple equal maxima) resolve to the first index, matching the
 *   common `argmax` convention.
 *
 * @example
 * ```typescript
 * const cost = new CategoricalError();
 * const target = new Float32Array([0, 1, 0]); // true class = 1
 * const output = new Float32Array([0.2, 0.7, 0.1]); // predicted class = 1
 * cost.calculate(target, output); // 0 (correct)
 *
 * const wrong = new Float32Array([0.6, 0.3, 0.1]); // predicted class = 0
 * cost.calculate(target, wrong); // 1 (incorrect)
 * ```
 */
export class CategoricalError implements CostInterface {
  static readonly NAME = "CATEGORICAL_ERROR";

  /**
   * Returns the name of this cost function.
   * @returns The string "CATEGORICAL_ERROR"
   */
  getName(): string {
    return CategoricalError.NAME;
  }

  /**
   * Returns `0` when the predicted class (argmax of `output`) matches the true
   * class (argmax of `target`), otherwise `1`.
   *
   * @param target - The one-hot encoded true labels.
   * @param output - The predicted class scores/probabilities.
   * @returns `0` for a correct argmax prediction, `1` for an incorrect one.
   */
  calculate(target: Float32Array, output: Float32Array): number {
    const len = output.length;
    if (len === 0) {
      return 0;
    }

    let targetArgmax = 0;
    let targetMax = target[0];
    let outputArgmax = 0;
    let outputMax = output[0];

    for (let i = 1; i < len; i++) {
      if (target[i] > targetMax) {
        targetMax = target[i];
        targetArgmax = i;
      }
      if (output[i] > outputMax) {
        outputMax = output[i];
        outputArgmax = i;
      }
    }

    return targetArgmax === outputArgmax ? 0 : 1;
  }
}
