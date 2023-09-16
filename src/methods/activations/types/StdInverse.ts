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
    return activation !== 0 ? 1 / activation : 0;
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
