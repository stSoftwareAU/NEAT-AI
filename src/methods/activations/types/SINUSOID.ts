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
   * Since sine is periodic, unSquash returns arcsin (inverse sine).
   * This will return values within the range [-π/2, π/2].
   * We use the hint to adjust for the periodic nature of sin(x).
   */
  unSquash(activation: number, hint?: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    const range = this.range();
    if (activation < range.low || activation > range.high) {
      throw new Error(
        `${this.getName()}: Activation value ${activation} is outside the valid range [${range.low}, ${range.high}]`,
      );
    }

    // Get the base value within [-π/2, π/2]
    const baseValue = Math.asin(activation);

    if (hint !== undefined) {
      // Adjust using the hint. The difference between baseValue and hint should be close to a multiple of π.
      const difference = hint - baseValue;
      const adjustment = Math.round(difference / Math.PI) * Math.PI;

      // Return the adjusted value that is closer to the hint
      const adjustedValue = baseValue + adjustment;

      return adjustedValue;
    }

    // If no hint is provided, return the base value within [-π/2, π/2]
    console.info(`SINUSOID unSquash: ${activation}, no hint -> ${baseValue}`);
    return baseValue;
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
  squash(x: number): number {
    return Math.sin(x);
  }
}
