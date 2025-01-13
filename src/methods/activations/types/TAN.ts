import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TAN Activation Function
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Trigonometric_functions#Tan
 */
export class TAN
  implements
    ActivationInterface,
    UnSquashInterface,
    InlineSquashInterface,
    SimplifyBiasInterface {
  simplifyBias(bias: number): number {
    return bias % Math.PI; // Simplify the bias using the periodicity of tan(x)
  }

  public static NAME = "TAN";

  public readonly range: ActivationRange = new ActivationRange(
    TAN.NAME,
    -Infinity,
    Infinity, // Tan(x) is unbounded
  );

  /**
   * UnSquash Function
   * Estimates the input from the activation value.
   * - Uses arctan for the base value.
   * - Adjusts for periodicity using the provided hint (if available).
   */
  unSquash(activation: number, hint?: number): number {
    // Validate activation value (no upper/lower bounds for tan)
    if (!isFinite(activation)) {
      throw new Error("Activation must be finite.");
    }

    // Base value using arctan (range: [-π/2, π/2])
    const baseValue = Math.atan(activation);

    if (hint !== undefined) {
      // Adjust using the hint to find the closest equivalent within the periodic cycle
      const difference = hint - baseValue;
      const adjustment = Math.round(difference / Math.PI) * Math.PI;

      // Return the adjusted value closer to the hint
      return baseValue + adjustment;
    }

    // If no hint is provided, return the base value
    return baseValue;
  }

  getName() {
    return TAN.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.tan(${value})`; // Inline JavaScript code for tan(x)
  }

  squash(x: number): number {
    return Math.tan(x); // Squash function definition
  }
}
