import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Clipped Activation Function
 * Forces all input values to fall within the range [-1, 1].
 * It is non-differentiable at x = -1 and x = 1.
 * Formula: f(x) = max(-1, min(1, x))
 */
export class CLIPPED implements ActivationInterface, UnSquashInterface {
  public static NAME = "CLIPPED";

  getName() {
    return CLIPPED.NAME;
  }

  range(): { low: number; high: number } {
    return { low: -1, high: 1 };
  }

  unSquash(activation: number): number {
    // Note that unSquash is not applicable since CLIPPED is a clipping function.
    // It does not have a unique inverse, so we'll just return the activation itself.
    return activation;
  }

  squash(x: number) {
    return Math.max(-1, Math.min(1, x));
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    // The derivative is 1 for x in [-1, 1] and 0 otherwise.
    return {
      activation: fx,
      derivative: x > -1 && x < 1 ? 1 : 0,
    };
  }
}
