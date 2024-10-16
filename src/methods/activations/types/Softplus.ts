import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softplus Activation Function
 *
 * The Softplus function is defined as f(x) = ln(1 + exp(x)).
 * It smooths out the ReLU function, and its derivative is the logistic function.
 *
 * The derivative is f'(x) = 1 / (1 + exp(-x)).
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#Softplus
 */
export class Softplus implements ActivationInterface, UnSquashInterface {
  public static NAME = "Softplus";

  private static readonly LARGE_THRESHOLD = 100; // Threshold to prevent overflow in unSquash
  private static readonly SMALL_THRESHOLD = 1e-15; // Threshold to prevent underflow in unSquash

  public readonly range: ActivationRange = new ActivationRange(
    this,
    Softplus.SMALL_THRESHOLD,
    Softplus.LARGE_THRESHOLD,
  );

  // Inverse of Softplus
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // If activation is too small or large, return it as the best guess
    if (activation <= 0) {
      return activation; // Negative values are outside the valid Softplus range, just return them
    }

    if (activation > Softplus.LARGE_THRESHOLD) {
      return activation; // For very large values, it's best to return the activation
    }

    if (activation < Softplus.SMALL_THRESHOLD) {
      return activation; // Return small activations as-is to prevent underflow issues
    }

    return Math.log(Math.exp(activation) - 1); // Standard un-squashing calculation
  }

  getName() {
    return Softplus.NAME;
  }

  // Softplus function definition
  squash(x: number) {
    // Prevent overflow when x is too large
    if (x >= 709) { // 709 is the limit where exp(709) gives the largest finite result in JS
      return Softplus.LARGE_THRESHOLD; // Return a large value, not Infinity
    }

    const value = Math.log(1 + Math.exp(x)); // Standard Softplus formula

    return this.range.limit(value);
  }
}
