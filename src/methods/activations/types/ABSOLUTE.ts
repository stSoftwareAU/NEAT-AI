import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Absolute (ABSOLUTE) activation function.
 *
 * This activation function takes the absolute value of the input. The derivative is -1 for
 * negative input and 1 for positive input.
 *
 * Note: This function doesn't have a unique inverse, so the unSquash function will return
 * one possible original value (positive version of the input).
 */
export class ABSOLUTE implements ActivationInterface, UnSquashInterface {
  public static NAME = "ABSOLUTE";
  public readonly range: ActivationRange = new ActivationRange(
    this,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if ((hint ? hint : 0) < 0) {
      return -activation;
    }

    return activation;
  }

  // range() {
  //   return { low: 0, high: Number.POSITIVE_INFINITY };
  // }

  getName() {
    return ABSOLUTE.NAME;
  }

  squash(x: number) {
    return this.range.limit(Math.abs(x));
  }
}
