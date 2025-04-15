/**
 * Cosine activation function
 * Squash function: f(x) = cos(x)
 * Range: [-1, 1]
 * Source: Custom (Cosine is a standard mathematical function)
 */
import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class Cosine
  implements
    ActivationInterface,
    UnSquashInterface,
    InlineSquashInterface,
    SimplifyBiasInterface {
  public static NAME = "Cosine";
  public readonly range: ActivationRange = new ActivationRange(
    Cosine.NAME,
    -1,
    1,
  );

  getName() {
    return Cosine.NAME;
  }

  simplifyBias(bias: number): number {
    const tmp = bias % (2 * Math.PI);
    return tmp;
  }

  inlineSquash(value: string): string {
    return `Math.cos(${value})`;
  }

  squash(x: number) {
    return Math.cos(x);
  }

  unSquash(activation: number, hint: number = 0): number {
    // Validate activation range
    if (activation < -1 || activation > 1) {
      throw new Error(
        `Activation ${activation} is outside valid range [-1, 1]`,
      );
    }

    // Get the principal value (in range [0, π])
    const principalValue = Math.acos(activation);

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
        // 2. -principalValue + 2πn
        solutions.add(principalValue + i * period);
        solutions.add(-principalValue + i * period);
      }

      return Array.from(solutions);
    };

    // Get all possible solutions
    const solutions = getSolutions(hint);

    // Function to check if a solution produces the correct activation
    const isValidSolution = (x: number) => {
      return Math.abs(Math.cos(x) - activation) < 1e-10;
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
}
