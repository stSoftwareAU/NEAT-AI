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

import type { ActivationInterface } from "../ActivationInterface.ts";
import {
  type UnSquashInterface,
  validationActivation,
} from "../UnSquashInterface.ts";

export class GELU implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "GELU";
  private static readonly MAX_ITERATIONS = 100; // Maximum iterations for Newton-Raphson

  private static readonly TOLERANCE = 1e-6;
  /**
   * Computes the GELU activation function using an approximation for efficiency.
   * GELU is approximated as f(x) = 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3))).
   * This approximation is widely used due to its balance between accuracy and computational efficiency.
   * @param x The input value to the activation function.
   * @returns The output of the GELU activation function.
   */
  squash(x: number): number {
    const sqrtTwoOverPi = Math.sqrt(2 / Math.PI);
    const term = x + 0.044715 * Math.pow(x, 3);
    const tanhResult = Math.tanh(sqrtTwoOverPi * term);
    return 0.5 * x * (1 + tanhResult);
  }

  /**
   * Approximates the inverse of the GELU function using the Newton-Raphson method.
   * Since GELU includes non-linear transformations, this inverse is not straightforward and is approximated.
   * @param activation The output value from the GELU function.
   * @param hint An optional initial guess for the Newton-Raphson method.
   * @returns The estimated input value that would produce the given activation output.
   */
  unSquash(activation: number, hint?: number): number {
    validationActivation(this, activation);

    let x = hint ?? activation; // Simplified guess initialization

    for (let i = 0; i < GELU.MAX_ITERATIONS; i++) {
      const fx = this.squash(x) - activation;
      if (Math.abs(fx) < GELU.TOLERANCE) {
        break;
      }

      const dfx = this.derivative(x);
      x = x - fx / dfx; // Newton-Raphson update

      if (!Number.isFinite(x) || Math.abs(x) > 10) {
        // If x becomes non-finite or unreasonably large, break out
        x = hint ?? 0; // Reset to hint or zero
        break;
      }
    }

    return x;
  }

  derivative(x: number): number {
    const sqrtTwoOverPi = Math.sqrt(2 / Math.PI);
    const a = 0.044715 * Math.pow(x, 3);
    const b = sqrtTwoOverPi * (x + a);
    const sech2 = (2 / (Math.exp(b) + Math.exp(-b))) ** 2;
    return 0.5 * x * sech2 * sqrtTwoOverPi * (3 * 0.044715 * x * x + 1) +
      0.5 * (1 + Math.tanh(b));
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  getName(): string {
    return GELU.NAME;
  }
}
