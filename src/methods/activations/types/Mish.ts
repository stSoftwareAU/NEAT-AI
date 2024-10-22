import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

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
  private static readonly MAX_ITERATIONS = 100; // Maximum iterations for Newton-Raphson
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName() {
    return Mish.NAME;
  }

  squash(x: number) {
    const value = x * Math.tanh(Math.log(1 + Math.exp(x)));

    return this.range.limit(value, x);
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
    // Validate the activation value
    this.range.validate(activation, hint);

    // Initial guess: use hint if provided, otherwise a reasonable guess based on the activation value
    let guess = hint !== undefined
      ? hint
      : (activation >= 0
        ? activation
        : (activation < -1 ? -1 : activation / 2)); // Adjust initial guess for negative values

    const tolerance = 0.0001; // Tolerance for convergence
    const maxIterations = Mish.MAX_ITERATIONS;
    const safeLimit = Number.MAX_SAFE_INTEGER / 2; // Prevent overflow by clamping

    // Limit the initial guess to a safe range
    if (Math.abs(guess) > safeLimit) {
      guess = Math.sign(guess) * safeLimit;
    }

    for (let i = 0; i < maxIterations; i++) {
      const { activation: squashGuess, derivative: errDerivative } = this
        .squashAndDerive(guess);

      const err = squashGuess - activation;

      // Check for NaN or extreme values in the derivative to avoid invalid guesses
      if (
        !Number.isFinite(errDerivative) ||
        Math.abs(errDerivative) < Number.EPSILON
      ) {
        break;
      }

      // Ensure the derivative is not too small before dividing
      const adjustedErrDerivative = Math.abs(errDerivative) < 1e-6
        ? Math.sign(errDerivative) * 1e-6
        : errDerivative;

      // Update guess with a check for NaN or Infinity
      guess -= err / (adjustedErrDerivative + Number.EPSILON); // Use adjusted derivative to prevent division by zero

      // Clamp guess to avoid extreme values
      if (Math.abs(guess) > safeLimit) {
        guess = Math.sign(guess) * safeLimit;
      }

      // Check for convergence within tolerance
      if (Math.abs(err) < tolerance) {
        break; // Converged successfully
      }
    }

    // Return the final guess, ensuring it's a finite number, otherwise default to 0
    return Number.isFinite(guess) ? guess : 0;
  }
}
