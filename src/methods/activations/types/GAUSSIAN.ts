import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

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
  range(): { low: number; high: number } {
    return { low: 0, high: 1 };
  }

  // unSquash is non-trivial due to the symmetric nature of Gaussian function.
  unSquash(activation: number): number {
    // Since it's symmetric, we'll return the positive root only.
    return Math.sqrt(-Math.log(activation));
  }

  squash(x: number) {
    return Math.exp(-Math.pow(x, 2));
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: -2 * x * fx,
    };
  }
}
