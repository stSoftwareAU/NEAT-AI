import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TANH (Hyperbolic Tangent) Activation Function
 *
 * The TANH function maps any input to values between -1 and 1.
 * It is an S-shaped curve similar to the sigmoid but outputs values across a greater range.
 * The derivative is calculated as 1 - tanh^2(x).
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Hyperbolic_functions#Hyperbolic_tangent
 */
export class TANH implements ActivationInterface, UnSquashInterface {
  // Function to estimate the input from the activation value.
  // TANH is invertible, and its inverse is calculated using a logarithmic function.
  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    if (Math.abs(activation) === 1) {
      return activation; // Return activation as the best guess if it's 1 or -1
    }

    const value = (1 + activation) / (1 - activation);
    if (value <= 0) {
      return activation; // Return activation as the best guess if the argument to Math.log is not positive
    }
    return 0.5 * Math.log(value);
  }

  // Range of the activation function. TANH outputs values between -1 and 1.
  range() {
    return { low: -1, high: 1 };
  }

  public static NAME = "TANH";

  getName() {
    return TANH.NAME;
  }

  // TANH function definition
  squash(x: number) {
    return Math.tanh(x);
  }
}
