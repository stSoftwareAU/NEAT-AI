import { assert } from "@std/assert";
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
   * Since sine is periodic, unSquash returns arcsine (inverse sine).
   * This will return values within the range [-π/2, π/2].
   * We use the hint to adjust for the periodic nature of sin(x).
   */
  unSquash(activation: number, hint: number = 0): number {
    assert(
      activation >= -1 && activation <= 1,
      `Activation ${activation} is out of range [-1, 1]`,
    );

    // Get the principal value
    const principal = Math.asin(activation);

    // Find all possible solutions within 4 periods of the hint
    const period = 2 * Math.PI;
    const solutions: number[] = [];

    // Calculate how many periods away the hint is from 0
    const hintPeriods = Math.round(hint / period);

    // Check solutions in both positive and negative directions
    for (let i = -4; i <= 4; i++) {
      const basePeriod = hintPeriods + i;

      // Try both principal value and its complement
      const sol1 = principal + basePeriod * period;
      const sol2 = Math.PI - principal + basePeriod * period;

      // Verify each solution produces the correct activation
      if (Math.abs(Math.sin(sol1) - activation) < 1e-10) {
        solutions.push(sol1);
      }
      if (Math.abs(Math.sin(sol2) - activation) < 1e-10) {
        solutions.push(sol2);
      }
    }

    // If no valid solutions found, return the closest principal solution
    if (solutions.length === 0) {
      const sol1 = principal + hintPeriods * period;
      const sol2 = Math.PI - principal + hintPeriods * period;
      return Math.abs(sol1 - hint) < Math.abs(sol2 - hint) ? sol1 : sol2;
    }

    // Return the solution closest to the hint
    return solutions.reduce((best, current) =>
      Math.abs(current - hint) < Math.abs(best - hint) ? current : best
    );
  }

  getName() {
    return SINE.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.sin(${value})`;
  }

  // SINE function definition
  squash(x: number) {
    return Math.sin(x);
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    return Math.cos(x);
  }

  /**
   * Calculates error for SINE activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = sin(x)
   *   f′(x) = cos(x)
   *
   * Strategy:
   *   ✅ Use derivative if slope is non-zero and finite.
   *   🥽 Fallback to foggy-glasses unSquash-based error if slope too small or not finite.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    const rawError = targetActivation - currentActivation;

    const x = this.unSquash(currentActivation, hint);
    const slope = this.derivative(x);

    const safeSlope = Number.isFinite(slope)
      ? Math.abs(slope) < 1e-8 ? 0 : Math.min(Math.max(slope, -50), 50)
      : Math.sign(slope);

    if (safeSlope !== 0) {
      return rawError * safeSlope;
    }

    // 🥽 Fallback: use unSquash delta if derivative fails
    const rawCurrent = this.unSquash(currentActivation, hint);
    const rawTarget = this.unSquash(targetActivation, hint);
    const error = rawTarget - rawCurrent;

    return Number.isFinite(error) ? error : 0;
  }
}
