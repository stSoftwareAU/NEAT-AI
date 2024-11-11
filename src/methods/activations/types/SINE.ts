import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * SINE Activation Function
 *
 * The SINE function maps the input to a sinusoidal wave, returning values between -1 and 1.
 * This function can be useful for learning periodic patterns.
 * The derivative is calculated as the cosine of the input.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Sine
 */
export class SINE implements ActivationInterface, UnSquashInterface {
  public static NAME = "SINE";

  public readonly range: ActivationRange = new ActivationRange(this, -1, 1);

  // Function to estimate the input from the activation value.
  // The inverse of the sine function (arcsine) is used here.
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // If the activation is at the boundaries, return the best guess
    if (Math.abs(activation) === 1) {
      return activation > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    // Use arcsine for the inverse function
    return Math.asin(activation);
  }

  getName() {
    return SINE.NAME;
  }

  // SINE function definition
  squash(x: number) {
    return Math.sin(x);
  }
}
