/**
 * The Swish activation function, sometimes also known as SiLU (Sigmoid Linear Unit).
 * Swish is defined as: f(x) = x * sigmoid(x), where sigmoid(x) = 1 / (1 + exp(-x)).
 * It has been found to work well in deep networks, outperforming ReLU in some scenarios.
 *
 * Source: "Swish: a Self-Gated Activation Function" by Prajit Ramachandran, Barret Zoph, and Quoc V. Le
 * Link: https://arxiv.org/abs/1710.05941
 */
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class Swish implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "Swish";
  private static readonly MAX_ITERATIONS = 100; // Maximum iterations for Newton-Raphson
  private static readonly EPSILON = 1e-6; // Tolerance for Newton-Raphson
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  /**
   * Computes the Swish activation function.
   * Swish is defined as f(x) = x * sigmoid(x), where sigmoid(x) = 1 / (1 + exp(-x)).
   * This implementation guards against overflow in the exp(-x) calculation.
   * @param x The input value to the activation function.
   * @returns The output of the Swish activation function.
   */
  squash(x: number): number {
    // Guard against overflow in exp(-x) when x is a large negative number.
    const expNegX = x < -20 ? 0 : Math.exp(-x);
    const value = x / (1 + expNegX);
    return this.range.limit(value);
  }

  /**
   * Attempts to compute the inverse of the Swish function using the Newton-Raphson method.
   * This is not commonly required for neural network applications, but can be useful
   * for analytical purposes or specific scenarios where the pre-activation value needs to be inferred.
   * @param activation The output value from the Swish function.
   * @param hint An optional initial guess for the Newton-Raphson method.
   * @returns The estimated input value that would produce the given activation output.
   */
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    let x = hint !== undefined
      ? hint
      : (activation >= 0 ? activation : activation / 2);

    for (let i = 0; i < Swish.MAX_ITERATIONS; i++) {
      const expNegX = x < -20 ? 0 : Math.exp(-x);
      const sigmoidX = 1 / (1 + expNegX);
      const fx = x * sigmoidX - activation;

      if (Math.abs(fx) < Swish.EPSILON) {
        break;
      }

      const dfx = sigmoidX + x * (-expNegX) / Math.pow(1 + expNegX, 2);
      x = x - fx / dfx;

      // If x is not a finite number or does not improve, use the best guess
      if (!Number.isFinite(x) || Math.abs(fx) < Swish.EPSILON) {
        return x;
      }
    }

    return x;
  }

  // range() {
  //   return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  // }

  getName(): string {
    return Swish.NAME;
  }
}
