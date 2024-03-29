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

  unSquash(activation: number, hint?: number): number {
    if (Math.abs(hint ? hint : 0) > 1) return hint ? hint : 0;
    return activation;
  }

  squash(x: number) {
    const v = Math.max(-1, Math.min(1, x));

    return v;
  }

  // squashAndDerive(x: number) {
  //   const fx = this.squash(x);

  //   // The derivative is 1 for x in [-1, 1] and 0 otherwise.
  //   return {
  //     activation: fx,
  //     derivative: x > -1 && x < 1 ? 1 : 0,
  //   };
  // }
}
