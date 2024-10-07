import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

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
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    const range = this.range();
    if (activation < range.low || activation > range.high) {
      throw new Error(
        `${this.getName()}: Activation value ${activation} is outside the valid range [${range.low}, ${range.high}]`,
      );
    }

    // Clamp the activation to avoid exploding results near 1 and -1
    // const clampedActivation = Math.max(Math.min(activation, SOFTSIGN.LIMIT), -SOFTSIGN.LIMIT);

    // const value = clampedActivation / (1 - Math.abs(clampedActivation));
    const value = activation / (1 - Math.abs(activation));
    // console.info(`SOFTSIGN unSquash: ${activation}, hint: ${hint} -> ${value}`);
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
