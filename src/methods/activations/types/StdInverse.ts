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

    if (activation === 0) {
      return 0; // Return 0 if activation is 0
    }

    if (Math.abs(activation) < 1e-15) { // 1e-15 is a reasonable threshold to prevent overflow
      return activation > 0 ? Number.MAX_VALUE : Number.MIN_VALUE; // Return a large positive or negative number as the best guess if activation is a very small positive or negative number
    }

    return 1 / activation;
  }

  range(): { low: number; high: number } {
    return { low: 0, high: Infinity };
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: x !== 0 ? -1 / (x * x) : 0,
    };
  }
}
