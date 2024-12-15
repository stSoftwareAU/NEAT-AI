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

  // Set a maximum finite value to return instead of Infinity
  private static readonly MAX_VALUE = 1e10;

  public readonly range: ActivationRange = new ActivationRange(
    ArcTan.NAME,
    -Math.PI / 2,
    Math.PI / 2,
  );

  // Function to estimate the input from the activation value.
  // The inverse of arctangent is the tangent function.
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // Handle boundary cases by approximating large values
    const epsilon = 1e-5; // Small value to avoid exact boundary issues

    if (activation >= Math.PI / 2 - epsilon) {
      return Number.MAX_SAFE_INTEGER;
    } else if (activation <= -Math.PI / 2 + epsilon) {
      return -Number.MAX_SAFE_INTEGER;
    }

    // Use tangent as the inverse function
    const value = Math.tan(activation);
    if (Number.isFinite(value)) {
      return value;
    }

    throw new Error(
      `ArcTan unSquash ${activation} failed, ${value} is not finite`,
    );
  }

  getName() {
    return ArcTan.NAME;
  }

  // ArcTan function definition
  squash(x: number) {
    return Math.atan(x);
  }
}
