/**
 * EXPONENTIAL activation function
 * Squash function: f(x) = exp(x)
 * Range: (0, +Infinity)
 * Source: Custom (Exponential is a standard mathematical function)
 */
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class Exponential implements ActivationInterface, UnSquashInterface {
  public static NAME = "Exponential";

  getName() {
    return Exponential.NAME;
  }

  squash(x: number) {
    if (x >= 709) { // 709 is a reasonable threshold to prevent overflow, as Math.exp(709) is the largest finite number in JavaScript
      return Number.MAX_VALUE; // Return a large positive number as the best guess if x is too large
    }

    return Math.exp(x);
  }

  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    if (activation <= 0) {
      return activation; // Our best guess if activation is 0 or less
    }

    return Math.log(activation);
  }

  range() {
    return { low: 0, high: Number.POSITIVE_INFINITY };
  }
}
