import type { ActivationInterface } from "../ActivationInterface.ts";
import {
  type UnSquashInterface,
  validationActivation,
} from "../UnSquashInterface.ts";

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
  private static LIMIT = 0.99; // Clamped limit to avoid numerical issues

  /* The inverse of Softsign is x = f(x) / (1 - |f(x)|)*/
  unSquash(activation: number): number {
    validationActivation(this, activation);

    const value = activation / (1 - Math.abs(activation));

    return value;
  }

  /* Range of the activation function. Softsign outputs values between -1 and +1.*/
  range() {
    return { low: -SOFTSIGN.LIMIT, high: SOFTSIGN.LIMIT };
  }

  public static NAME = "SOFTSIGN";

  getName() {
    return SOFTSIGN.NAME;
  }

  // Softsign function definition
  squash(x: number): number {
    const d = 1 + Math.abs(x);
    const value = x / d;
    // Clamp the output to stay within the limit
    return Math.max(Math.min(value, SOFTSIGN.LIMIT), -SOFTSIGN.LIMIT);
  }
}
