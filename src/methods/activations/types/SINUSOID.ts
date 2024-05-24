import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Sinusoid Activation Function
 *
 * The Sinusoid function is defined as f(x) = sin(x). It is periodic and bounded.
 * The derivative is f'(x) = cos(x).
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Sine
 */
export class SINUSOID implements ActivationInterface, UnSquashInterface {
  /* Function to estimate the input from the activation value.
   * Because the sine function is periodic, unSquash will return the
   * inverse sine (arcsin) as an estimate. This is not a perfect inversion.
   */
  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }
    if (activation < -1 || activation > 1) {
      return activation;
    }
    return Math.asin(activation);
  }

  // Range of the activation function. Sinusoid outputs values between -1 and 1.
  range() {
    return { low: -1, high: 1 };
  }

  public static NAME = "SINUSOID";

  getName() {
    return SINUSOID.NAME;
  }

  // Sinusoid function definition
  squash(x: number) {
    return Math.sin(x);
  }
}
