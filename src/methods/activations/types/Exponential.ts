/**
 * EXPONENTIAL activation function
 * Squash function: f(x) = exp(x)
 * Range: (0, +Infinity)
 * Source: Custom (Exponential is a standard mathematical function)
 */
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class Exponential implements ActivationInterface, UnSquashInterface {
  public static NAME = "Exponential";

  public readonly range: ActivationRange = new ActivationRange(
    this,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return Exponential.NAME;
  }

  squash(x: number) {
    if (x >= 709) { // 709 is a reasonable threshold to prevent overflow, as Math.exp(709) is the largest finite number in JavaScript
      return Number.MAX_SAFE_INTEGER; // Return a large positive number as the best guess if x is too large
    }

    const value = Math.exp(x);
    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation <= 0) {
      return activation; // Our best guess if activation is 0 or less
    }

    return Math.log(activation);
  }

  // range() {
  //   return { low: 0, high: Number.POSITIVE_INFINITY };
  // }
}
