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
    const e_x = Math.exp(x);
    const e_2x = Math.exp(2 * x);
    const x_2 = x * x;
    const x_3 = x * x * x;

    const omega = 4 * e_2x + 4 * e_x * x + e_2x * x_2 + 2 * e_x * x_2 +
      2 * x_3 + 4 * e_x + 4 * x + 6;
    const delta = 2 + 2 * e_x + e_2x;
    const derivative = e_x * omega / (delta ** 2);

    return {
      activation: this.squash(x),
      derivative: derivative,
    };
  }

  unSquash(activation: number, hint?: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    let guess = hint !== undefined
      ? hint
      : (activation >= 0
        ? activation
        : (activation < -1 ? -1 : activation / 2)); // Use the hint as the initial guess if provided

    const iterations = 200_000; // Number of iterations; you can adjust this
    const tolerance = 0.0001; // Tolerance for convergence; you can adjust this

    for (let i = 0; i < iterations; i++) {
      const { activation: squashGuess, derivative: errDerivative } = this
        .squashAndDerive(guess);
      const err = squashGuess - activation;

      if (Math.abs(errDerivative) < Number.EPSILON) {
        // Derivative is zero, break the loop
        break;
      }

      guess -= err / (errDerivative + Number.EPSILON); // Use the constant EPSILON here

      if (Math.abs(err) < tolerance) {
        // Converged to the root
        break;
      }
    }

    return Number.isFinite(guess) ? guess : 0; // Return 0 if guess is not a finite number
  }

  range(): { low: number; high: number } {
    // Mish ranges from negative infinity to positive infinity
    return { low: -Infinity, high: Infinity };
  }
}
