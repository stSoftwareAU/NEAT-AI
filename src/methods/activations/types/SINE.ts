import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
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
export class SINE
  implements
    ActivationInterface,
    UnSquashInterface,
    InlineSquashInterface,
    SimplifyBiasInterface {
  simplifyBias(bias: number): number {
    return bias % (2 * Math.PI);
  }

  public static NAME = "SINE";

  public readonly range: ActivationRange = new ActivationRange(
    SINE.NAME,
    -1,
    1,
  );

  /* Function to estimate the input from the activation value.
   * Since sine is periodic, unSquash returns arcsin (inverse sine).
   * This will return values within the range [-π/2, π/2].
   * We use the hint to adjust for the periodic nature of sin(x).
   */
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

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
    return baseValue;
  }

  getName() {
    return SINE.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.sin( ${value})`;
  }

  // SINE function definition
  squash(x: number) {
    return Math.sin(x);
  }
}
