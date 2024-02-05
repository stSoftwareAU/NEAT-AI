import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bipolar Activation Function
 * Used in binary classification problems and outputs either -1 or 1.
 * The function is non-differentiable at zero.
 * Formula: f(x) = x > 0 ? 1 : -1
 */
export class BIPOLAR implements ActivationInterface, UnSquashInterface {
  public static NAME = "BIPOLAR";

  getName() {
    return BIPOLAR.NAME;
  }

  range(): { low: number; high: number } {
    return { low: -1, high: 1 };
  }

  unSquash(activation: number, hint?: number): number {
    if (Number.isFinite(hint)) return hint ? hint : 0;

    return activation;
  }

  squash(x: number) {
    return x > 0 ? 1 : -1;
  }

  // squashAndDerive(x: number) {
  //   const fx = this.squash(x);

  //   // The derivative is technically undefined at zero
  //   return {
  //     activation: fx,
  //     derivative: 0,
  //   };
  // }
}
