/**
 * LogSigmoid activation function
 * Squash function: f(x) = log(1 / (1 + exp(-x)))
 * Range: (-Infinity, 0]
 * Source: https://en.wikipedia.org/wiki/Logistic_function
 */
import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

export class LogSigmoid implements ActivationInterface, UnSquashInterface {
  public static NAME = "LogSigmoid";

  getName() {
    return LogSigmoid.NAME;
  }

  squash(x: number) {
    return Math.log(1 / (1 + Math.exp(-x)));
  }

  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      console.trace();
      throw new Error("Activation must be a finite number");
    }

    if (Math.abs(activation) < 1e-15) { // 1e-15 is a reasonable threshold to prevent underflow
      return 0; // Return 0 as the best guess if activation is a very small positive number
    }

    if (activation === 0) {
      return 0; // Return 0 as the best guess if activation is 0
    }

    if (Math.abs(activation) > 100) { // 100 is a reasonable threshold to prevent overflow
      return activation; // Return activation as the best guess if it's a large positive number
    }

    return Math.log(Math.exp(activation) / (1 - Math.exp(activation)));
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);
    return {
      activation: fx,
      derivative: Math.exp(-x) / (1 + Math.exp(-x)),
    };
  }

  range(): { low: number; high: number } {
    return { low: Number.NEGATIVE_INFINITY, high: 0 };
  }
}
