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
  unSquash(activation: number, hint: number = 0): number {
    // Validate activation range
    if (activation < -1 || activation > 1) {
      throw new Error(
        `Activation ${activation} is outside valid range [-1, 1]`,
      );
    }

    // Get the principal value (in range [-π/2, π/2])
    const principalValue = Math.asin(activation);

    // Function to get all possible solutions within 2 periods of the hint
    const getSolutions = (hint: number) => {
      const solutions = new Set<number>();
      const period = 2 * Math.PI;

      // Get the period number closest to the hint
      const periodNum = Math.round(hint / period);

      // Check 4 periods around the hint (-2, -1, 0, 1, 2)
      for (let i = periodNum - 2; i <= periodNum + 2; i++) {
        // For each period, we have two possible solutions:
        // 1. principalValue + 2πn
        // 2. π - principalValue + 2πn
        solutions.add(principalValue + i * period);
        solutions.add(Math.PI - principalValue + i * period);
      }

      return Array.from(solutions);
    };

    // Get all possible solutions
    const solutions = getSolutions(hint);

    // Function to check if a solution produces the correct activation
    const isValidSolution = (x: number) => {
      return Math.abs(Math.sin(x) - activation) < 1e-10;
    };

    // Filter out invalid solutions
    const validSolutions = solutions.filter(isValidSolution);

    if (validSolutions.length === 0) {
      // If no valid solutions found, return the principal value
      return principalValue;
    }

    // Sort solutions by distance from the hint
    validSolutions.sort((a, b) => {
      return Math.abs(a - hint) - Math.abs(b - hint);
    });

    return validSolutions[0];
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
