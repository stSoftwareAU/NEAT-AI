import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The COMPLEMENT activation function computes the inverse of the input.
 * It returns 1 - x for any input x. Useful for particular kinds of
 * normalization or balancing tasks.
 */
export class COMPLEMENT implements ActivationInterface, UnSquashInterface {
  public static NAME = "COMPLEMENT";

  getName() {
    return COMPLEMENT.NAME;
  }

  squash(x: number) {
    return 1 - x;
  }

  unSquash(activation: number): number {
    return 1 - activation;
  }

  range(): { low: number; high: number } {
    return { low: -Infinity, high: Infinity };
  }

  // squashAndDerive(x: number) {
  //   const fx = this.squash(x);

  //   return {
  //     activation: fx,
  //     derivative: -1,
  //   };
  // }
}
