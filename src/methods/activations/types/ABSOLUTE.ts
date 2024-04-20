import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

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

  unSquash(activation: number, hint?: number): number {
    if ((hint ? hint : 0) < 0) {
      return -activation;
    }

    return activation;
  }

  range() {
    return { low: 0, high: Number.POSITIVE_INFINITY };
  }

  getName() {
    return ABSOLUTE.NAME;
  }

  squash(x: number) {
    return Math.abs(x);
  }
}
