import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The COMPLEMENT activation function computes the inverse of the input.
 * It returns 1 - x for any input x. Useful for particular kinds of
 * normalization or balancing tasks.
 */
export class COMPLEMENT implements ActivationInterface, UnSquashInterface {
  public static NAME = "COMPLEMENT";
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  getName() {
    return COMPLEMENT.NAME;
  }

  squash(x: number) {
    return 1 - x;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return 1 - activation;
  }

  // range() {
  //   return { low: -Infinity, high: Infinity };
  // }
}
