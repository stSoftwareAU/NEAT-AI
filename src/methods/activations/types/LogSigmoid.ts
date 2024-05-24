/**
 * LogSigmoid activation function
 * Squash function: f(x) = log(1 / (1 + exp(-x)))
 * Range: (-Infinity, 0]
 * Source: https://en.wikipedia.org/wiki/Logistic_function
 */
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class LogSigmoid implements ActivationInterface, UnSquashInterface {
  public static NAME = "LogSigmoid";

  getName() {
    return LogSigmoid.NAME;
  }

  squash(x: number) {
    if (x <= -709) { // 709 is a reasonable threshold to prevent overflow, as Math.exp(709) is the largest finite number in JavaScript
      return Number.MIN_VALUE; // Return a large negative number as the best guess if x is too large in magnitude
    }

    return Math.log(1 / (1 + Math.exp(-x)));
  }

  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    if (Math.abs(activation) < 1e-15) { // 1e-15 is a reasonable threshold to prevent underflow
      return 0; // Return 0 as the best guess if activation is a very small positive number
    }

    if (activation === 0) {
      return 0; // Return 0 as the best guess if activation is 0
    }

    if (Math.abs(activation) >= 10) { // 10 is a reasonable threshold to prevent overflow
      return activation; // Return activation as the best guess if it's a large positive number
    }

    if (activation === 1) {
      return Number.MAX_VALUE; // Return a large positive number as the best guess if activation is 1
    }

    if (activation >= 1) {
      return activation; // Return activation as the best guess if it's a large positive number
    }

    const denominator = 1 - Math.exp(activation);
    if (denominator === 0) {
      return activation; // Return activation as the best guess if the denominator is 0
    }

    const result = Math.log(Math.exp(activation) / denominator);

    if (!Number.isFinite(result)) return activation;

    return result;
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: 0 };
  }
}
