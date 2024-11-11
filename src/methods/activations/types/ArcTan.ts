import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ArcTan (Inverse Tangent) Activation Function
 *
 * The ArcTan function maps the input to values between -π/2 and π/2.
 * It is a smooth, S-shaped curve similar to TANH but with a different asymptotic behavior.
 * The derivative is calculated as 1 / (1 + x^2).
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Inverse_trigonometric_functions#Arctangent
 */
export class ArcTan implements ActivationInterface, UnSquashInterface {
  public static NAME = "ArcTan";

  public readonly range: ActivationRange = new ActivationRange(
    this,
    -Math.PI / 2,
    Math.PI / 2,
  );

  // Function to estimate the input from the activation value.
  // The inverse of arctangent is the tangent function.
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // If the activation is at the boundaries, return the best guess
    if (Math.abs(activation) === Math.PI / 2) {
      return activation > 0
        ? Number.POSITIVE_INFINITY
        : Number.NEGATIVE_INFINITY;
    }

    // Use tangent as the inverse function
    return Math.tan(activation);
  }

  getName() {
    return ArcTan.NAME;
  }

  // ArcTan function definition
  squash(x: number) {
    return Math.atan(x);
  }
}
