import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The StdInverse activation function computes the reciprocal of the input.
 * It returns 1 / x for any non-zero input x. Returns zero for zero input.
 * Please note that this is not commonly used as an activation function in neural networks.
 */
export class StdInverse implements ActivationInterface, UnSquashInterface {
  public static NAME = "StdInverse";

  getName() {
    return StdInverse.NAME;
  }

  squash(x: number) {
    return x !== 0 ? 1 / x : 0;
  }

  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    if (Math.abs(activation) < 1e-15) { // 1e-15 is a reasonable threshold to prevent overflow
      return activation > 0 ? Number.MAX_VALUE : Number.MIN_VALUE; // Return a large positive or negative number as the best guess if activation is a very small positive or negative number
    }

    return 1 / activation;
  }

  range() {
    return { low: -Infinity, high: Infinity };
  }
}
