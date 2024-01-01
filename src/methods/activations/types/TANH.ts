import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

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
    // if (activation >= 1 || activation <= -1) {
    //   throw new Error("Input to unSquash must be in the range (-1, 1)");
    // }
    return 0.5 * Math.log((1 + activation) / (1 - activation));
  }

  // Range of the activation function. TANH outputs values between -1 and 1.
  range(): { low: number; high: number } {
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

  // Function to calculate the activation and its derivative
  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: 1 - Math.pow(fx, 2),
    };
  }
}
