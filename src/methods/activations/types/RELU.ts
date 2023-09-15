import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ReLU (Rectified Linear Unit) Activation Function
 *
 * ReLU is defined as f(x) = max(0, x). It's widely used in neural networks for
 * hidden layers. The derivative is 1 for x > 0 and 0 for x <= 0.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)
 */
export class RELU implements ActivationInterface, UnSquashInterface {
  // Function to estimate the input from the activation value
  // As ReLU is not an invertible function, this estimation returns the same
  // value for the input and assumes that the input was non-negative.
  unSquash(activation: number): number {
    if (activation < 0) {
      throw new Error("Input to unSquash must be non-negative");
    }
    return activation;
  }

  // Range of the activation function. ReLU outputs values between 0 and positive infinity.
  range(): { low: number; high: number } {
    return { low: 0, high: Number.POSITIVE_INFINITY };
  }

  public static NAME = "RELU";

  getName() {
    return RELU.NAME;
  }

  // ReLU function definition
  squash(x: number) {
    return x > 0 ? x : 0;
  }

  // Function to calculate the activation and its derivative
  squashAndDerive(x: number) {
    const fx = this.squash(x);
    return {
      activation: fx,
      derivative: x > 0 ? 1 : 0,
    };
  }
}
