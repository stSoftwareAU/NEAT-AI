/**
 * The Swish activation function, sometimes also known as SiLU (Sigmoid Linear Unit).
 * Swish is defined as: f(x) = x * sigmoid(x), where sigmoid(x) = 1 / (1 + exp(-x)).
 * It has been found to work well in deep networks, outperforming ReLU in some scenarios.
 *
 * Source: "Swish: a Self-Gated Activation Function" by Prajit Ramachandran, Barret Zoph, and Quoc V. Le
 * Link: https://arxiv.org/abs/1710.05941
 */
import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

export class Swish implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "Swish";
  private static readonly MAX_ITERATIONS = 10_000; // Maximum iterations for Newton-Raphson
  private static readonly EPSILON = 1e-6; // Tolerance for Newton-Raphson

  unSquash(activation: number, hint?: number): number {
    let x = hint !== undefined
      ? hint
      : (activation >= 0 ? activation : activation / 2); // Use the hint as the initial guess if provided

    for (let i = 0; i < Swish.MAX_ITERATIONS; i++) {
      const fx = x / (1 + Math.exp(-x)) - activation;

      // Check for convergence
      if (Math.abs(fx) < Swish.EPSILON) {
        break;
      }

      const sigmoid_x = 1 / (1 + Math.exp(-x));
      const dfx = sigmoid_x + x * Math.exp(-x) / Math.pow(1 + Math.exp(-x), 2);

      x = x - fx / dfx;

      // If x is not a finite number, return the best guess
      if (!Number.isFinite(x)) {
        return activation >= 0 ? activation : activation / 2;
      }
    }

    return x;
  }

  range(): { low: number; high: number } {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  getName() {
    return Swish.NAME;
  }

  squash(x: number) {
    return x * (1 / (1 + Math.exp(-x)));
  }

  // squashAndDerive(x: number) {
  //   const sigmoid_x = 1 / (1 + Math.exp(-x));
  //   return {
  //     activation: this.squash(x),
  //     derivative: sigmoid_x * (1 + x * (1 - sigmoid_x)),
  //   };
  // }
}
