import type { ActivationInterface } from "../ActivationInterface.ts";
import {
  type UnSquashInterface,
  validationActivation,
} from "../UnSquashInterface.ts";

/**
 * Gaussian Activation Function
 * Smooth, bell-shaped function centered at zero.
 * Formula: f(x) = exp(-x^2)
 * Source: General mathematical function commonly used for its smoothness.
 */
export class GAUSSIAN implements ActivationInterface, UnSquashInterface {
  public static NAME = "GAUSSIAN";

  getName() {
    return GAUSSIAN.NAME;
  }

  // Range of the activation function is [0, 1]
  range() {
    return { low: 0, high: 1 };
  }

  /* unSquash is non-trivial due to the symmetric nature of Gaussian function. */
  unSquash(activation: number, hint?: number): number {
    validationActivation(this, activation);

    if (activation <= 0) {
      return activation; // Return 0 as the best guess if activation is 0
    }

    if (activation > 1) {
      return activation; // Return 1 as the best guess if activation is greater than 1
    }

    const sqrt = Math.sqrt(-Math.log(activation));

    // If no hint is provided, return the positive root
    if (hint === undefined) {
      return sqrt;
    }

    // If a hint is provided, return the root with the same sign as the hint
    return hint >= 0 ? Math.abs(sqrt) : -Math.abs(sqrt);
  }

  squash(x: number) {
    return Math.exp(-Math.pow(x, 2));
  }
}
