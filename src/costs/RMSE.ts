import type { CostInterface } from "@costs/CostInterface.ts";

/**
 * Root Mean Squared Error (RMSE) cost function.
 *
 * RMSE is the square root of the {@link MSE | Mean Squared Error}. It reports
 * the error in the same units as the target values, which makes it easier to
 * interpret than MSE while preserving MSE's heavier penalty on large errors.
 *
 * **Formula:** RMSE = √( (1/n) * Σ(y_true - y_pred)² )
 *
 * **Characteristics:**
 * - Same units as the target, so the magnitude is directly interpretable
 * - Monotonic in MSE — sorting creatures by RMSE and by MSE gives the same
 *   order — so it reuses the MSE squared-error sum unchanged and only adds a
 *   host-side `sqrt` at finalisation
 * - Sensitive to outliers due to the squared term (inherited from MSE)
 * - Commonly used for regression problems
 *
 * **Rust scorer parity:** the native `rust_scorer` binary serves `RMSE` on the
 * existing MSE GPU kernel with a host-side `sqrt` (NEAT-AI-scorer#339), so
 * `costName: "RMSE"` runs end-to-end at full MSE speed. This class keeps the
 * TypeScript `BUILT_IN_COST_NAMES` tuple in sync with the rust `CostKind` list
 * (NEAT-AI-scorer#340).
 *
 * **References:**
 * - [Wikipedia: Root-mean-square deviation](https://en.wikipedia.org/wiki/Root-mean-square_deviation)
 * - [Wikipedia: Loss function](https://en.wikipedia.org/wiki/Loss_function)
 *
 * @example
 * ```typescript
 * const rmse = new RMSE();
 * const target = new Float32Array([1.0, 2.0, 3.0]);
 * const output = new Float32Array([0.9, 2.1, 2.8]);
 * const error = rmse.calculate(target, output);
 * getLogger().info(error); // Root of the average squared error
 * ```
 */
export class RMSE implements CostInterface {
  static readonly NAME = "RMSE";

  /**
   * Returns the name of this cost function.
   * @returns The string "RMSE"
   */
  getName(): string {
    return RMSE.NAME;
  }

  /**
   * Calculates the root mean squared error between target and output arrays.
   *
   * Computes the mean squared error and takes its square root, so the result
   * is always non-negative and reported in the same units as the targets.
   *
   * @param target - The true/expected values
   * @param output - The predicted values
   * @returns The root mean squared error (always non-negative)
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

    return Math.sqrt(error * invLen);
  }
}
