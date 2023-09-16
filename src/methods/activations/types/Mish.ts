import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Mish Activation Function.
 *
 * The function is defined as \( \text{Mish}(x) = x \times \tanh(\ln(1 + e^x)) \).
 * The derivative is precomputed for optimization.
 *
 * Source: "Mish: A Self Regularized Non-Monotonic Neural Activation Function"
 * by Diganta Misra (https://arxiv.org/abs/1908.08681)
 */
export class Mish implements ActivationInterface, UnSquashInterface {
  public static NAME = "Mish";

  getName() {
    return Mish.NAME;
  }

  squash(x: number) {
    return x * Math.tanh(Math.log(1 + Math.exp(x)));
  }

  squashAndDerive(x: number) {
    const omega = 4 * (x + 1) + 4 * Math.exp(2 * x) + Math.exp(3 * x) +
      Math.exp(x) * (4 * x + 6);
    const delta = 2 * Math.exp(x) + Math.exp(2 * x) + 2;
    const derivative = Math.exp(x) * omega / (delta ** 2);

    return {
      activation: this.squash(x),
      derivative: derivative,
    };
  }

  unSquash(activation: number): number {
    let guess = activation; // Initial guess
    const iterations = 5; // Number of iterations; you can adjust this
    for (let i = 0; i < iterations; i++) {
      const err = this.squash(guess) - activation;
      const errDerivative = this.squashAndDerive(guess).derivative;
      guess -= err / (errDerivative + 1e-7); // 1e-7 added to avoid division by zero
    }
    return guess;
  }

  range(): { low: number; high: number } {
    // Mish ranges from negative infinity to positive infinity
    return { low: -Infinity, high: Infinity };
  }
}
