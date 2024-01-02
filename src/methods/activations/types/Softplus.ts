import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softplus Activation Function
 *
 * The Softplus function is defined as f(x) = ln(1 + exp(x)).
 * It smoothes out the ReLU function, and its derivative is the logistic function.
 *
 * The derivative is f'(x) = 1 / (1 + exp(-x)).
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#Softplus
 */
export class Softplus implements ActivationInterface, UnSquashInterface {
  // Function to estimate the input from the activation value.
  // The inverse of Softplus is x = ln(exp(f(x)) - 1)
  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      console.trace();
      throw new Error("Activation must be a finite number");
    }

    if (activation <= 0) {
      return activation; // the best guess if activation is 0 or less
    }

    if (activation > 100) { // 100 is a reasonable threshold to prevent overflow
      return activation; // Return activation as the best guess if it's a large positive number
    }

    return Math.log(Math.exp(activation) - 1);
  }

  // Range of the activation function. Softplus outputs values between 0 and +Infinity.
  range(): { low: number; high: number } {
    return { low: 0, high: Number.POSITIVE_INFINITY };
  }

  public static NAME = "Softplus";

  getName() {
    return Softplus.NAME;
  }

  // Softplus function definition
  squash(x: number) {
    return Math.log(1 + Math.exp(x));
  }

  // Function to calculate the activation and its derivative
  squashAndDerive(x: number) {
    return {
      activation: this.squash(x),
      derivative: 1 / (1 + Math.exp(-x)),
    };
  }
}
