/**
 * The GELU activation function, short for Gaussian Error Linear Unit.
 * GELU is approximated as: f(x) = 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3))).
 * This function is frequently used in neural network architectures, notably improving
 * performance in Transformer models, and is recognized for its capability to model stochastic
 * regularization effects implicitly.
 *
 * Source: "Gaussian Error Linear Unit (GELU)" by Dan Hendrycks and Kevin Gimpel
 * Link: https://arxiv.org/abs/1606.08415
 */

import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class GELU implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "GELU";
  private static readonly CUBIC_COEF = 0.044715; // Coefficient for cubic term
  private static readonly MAX_ITERATIONS = 100; // Maximum iterations for Newton-Raphson
  private static readonly TOLERANCE = 1e-6; // Tolerance for convergence
  private static readonly MAX_X = 10; // Maximum reasonable x value

  public readonly range = new ActivationRange(
    GELU.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  /**
   * Computes the GELU activation function using an approximation for efficiency.
   * GELU is approximated as f(x) = 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3))).
   * This approximation is widely used due to its balance between accuracy and computational efficiency.
   * @param x The input value to the activation function.
   * @returns The output of the GELU activation function.
   */
  squash(x: number): number {
    // For very large negative values, return a very small negative number
    if (x < -GELU.MAX_X) return -0;

    // For very large positive values, return the input
    if (x > GELU.MAX_X) return this.range.limit(x);

    // Standard GELU approximation
    const value = 0.5 * x *
      (1 +
        Math.tanh(
          Math.sqrt(2 / Math.PI) * (x + GELU.CUBIC_COEF * Math.pow(x, 3)),
        ));

    return this.range.limit(value);
  }

  /**
   * Approximates the inverse of the GELU function using the Newton-Raphson method.
   * Since GELU includes non-linear transformations, this inverse is not straightforward and is approximated.
   * @param activation The output value from the GELU function.
   * @param hint An optional initial guess for the Newton-Raphson method.
   * @returns The estimated input value that would produce the given activation output.
   */
  unSquash(activation: number, hint?: number): number {
    // Validate the activation is within the range
    this.range.validate(activation, hint);

    // Special case: if activation is very close to zero
    if (Math.abs(activation) < 1e-10) {
      // If we have a hint, use it directly
      if (hint !== undefined) {
        return hint;
      }
      // Default for very small values
      return -10;
    }

    // Initialize x with a good starting point
    let x: number;

    // Use hint if provided
    if (hint !== undefined) {
      x = hint;
    } else {
      // Otherwise, use a reasonable starting point based on the activation
      x = activation < 0.5 ? -1 : 1;
    }

    // Newton-Raphson iteration
    const MAX_ITERATIONS = 100;
    const TOLERANCE = 1e-6; // Match the legacy tolerance

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Calculate f(x) - activation
      const fx = this.squash(x) - activation;

      // Check if we've converged
      if (Math.abs(fx) < TOLERANCE) {
        break;
      }

      // Calculate the derivative
      const derivative = this.derivative(x);

      // Check if derivative is too small (would cause division by a very small number)
      if (Math.abs(derivative) < 1e-10) {
        // If we're close to the target, return the current value
        if (Math.abs(fx) < 0.1) {
          return x;
        }
        // Otherwise, try a different approach
        break;
      }

      // Calculate the next approximation
      const nextX = x - fx / derivative;

      // Check if the next value is valid
      if (!Number.isFinite(nextX) || Math.abs(nextX) > 10) {
        // If x becomes non-finite or unreasonably large, reset to hint or activation
        x = hint ?? 0;
        break;
      }

      // Update x for the next iteration
      x = nextX;
    }

    return x;
  }

  /**
   * Calculates the derivative of the GELU function.
   * This implementation is optimized for performance by caching repeated calculations.
   * @param x Input value
   * @returns Derivative value at x
   */
  derivative(x: number): number {
    // Cache x^2 and x^3 since they're used multiple times
    const x2 = x * x;
    const x3 = x2 * x;
    const cubicTerm = GELU.CUBIC_COEF * x3;
    const term = x + cubicTerm;
    const b = Math.sqrt(2 / Math.PI) * term;

    // Calculate tanh and sech^2 efficiently
    const expB = Math.exp(b);
    const expNegB = 1 / expB;
    const tanhB = (expB - expNegB) / (expB + expNegB);
    const sech2 = 1 - tanhB * tanhB;

    return 0.5 * (
      (1 + tanhB) +
      x * sech2 * Math.sqrt(2 / Math.PI) * (1 + 3 * GELU.CUBIC_COEF * x2)
    );
  }

  getName(): string {
    return GELU.NAME;
  }
}
