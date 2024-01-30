import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softsign Activation Function
 *
 * The Softsign function is defined as f(x) = x / (1 + |x|).
 * It's a smoother version of the sign function and similar to the hyperbolic tangent (tanh) but not centered at zero.
 *
 * The derivative is f'(x) = 1 / (1 + |x|)^2.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Comparison_of_activation_functions
 */
export class SOFTSIGN implements ActivationInterface, UnSquashInterface {
  /* The inverse of Softsign is x = f(x) / (1 - |f(x)|)*/
  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    if (Math.abs(activation) >= 1) {
      return activation;
    }

    return activation / (1 - Math.abs(activation));
  }

  /* Range of the activation function. Softsign outputs values between -1 and +1.*/
  range(): { low: number; high: number } {
    return { low: -1, high: 1 };
  }

  public static NAME = "SOFTSIGN";

  getName() {
    return SOFTSIGN.NAME;
  }

  // Softsign function definition
  squash(x: number) {
    const d = 1 + Math.abs(x);
    return x / d;
  }

  // Function to calculate the activation and its derivative
  // squashAndDerive(x: number) {
  //   const fx = this.squash(x);
  //   const d = 1 + Math.abs(x);

  //   return {
  //     activation: fx,
  //     derivative: 1 / Math.pow(d, 2),
  //   };
  // }
}
