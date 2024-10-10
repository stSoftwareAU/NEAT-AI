import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The IDENTITY activation function simply returns the input value.
 * It's mainly used in the output layer of regression problems.
 */
export class IDENTITY implements ActivationInterface, UnSquashInterface {
  public static NAME = "IDENTITY";

  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return activation;
  }

  // range() {
  //   return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  // }

  getName() {
    return IDENTITY.NAME;
  }

  squash(x: number) {
    return x;
  }
}
