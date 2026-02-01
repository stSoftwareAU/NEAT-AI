import { assert } from "@std/assert";
import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";

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
  implements ActivationInterface, UnSquashInterface, SimplifyBiasInterface {
  public mutationProbability = 16;
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
   *   f(x)   = sin(x)
   *   f′(x)  = cos(x)
   *   f⁻¹(y) = arcsin(y), ambiguous without sign/hint
   *
   * Strategy:
   *   ✅ Use derivative when slope (cos(x)) is stable
   *   🥽 Fallback to unSquash (arcsin) when slope is near 0
   *   🔒 Clamp result to prevent extreme weight changes
   *
   * Notes:
   *   - Slope is periodic and vanishes near x = ±π/2, ±3π/2, ...
   *   - arcsin fallback is safe if hint is used to resolve ambiguity
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue); // cos(x)

    let error: number;
    if (Math.abs(slope) > 1e-8) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue); // arcsin with hint
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * SINE Safe Zone Adjustment Logic
   *
   * The sine activation function is periodic and bounded within [-1, 1],
   * but its derivative (cosine) vanishes at odd multiples of π/2 (±π/2, ±3π/2, ...),
   * making gradient-based error propagation unstable in those regions.
   *
   * This function aims to:
   * - Prefer propagation when raw input is away from low-derivative zones
   * - Avoid updates that worsen derivative flatness
   * - Use weight updates when weight is far from optimal and could improve
   *
   * Strategy:
   * - Fully propagate when rawInput is not near a multiple of ±π/2
   * - If rawInput is near a flat slope region and error worsens it, return 0
   * - If weight is out of bounds and adjustment moves it toward ideal, prefer weight update
   * - Soft fade around problematic zones
   *
   * @param rawInput Raw input value (pre-squash)
   * @param error Backpropagated error
   * @param weight Synapse weight
   * @returns A number between 0 and 1 indicating preference to propagate
   */
  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;

    const slope = Math.cos(rawInput); // derivative of sin(x)
    const inFlatZone = Math.abs(slope) < 0.1;
    const rawGettingWorse = slope * error < 0;

    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;
    const weightImproving = (weightTooSmall && weight * error > 0) ||
      (weightTooLarge && weight * error < 0);

    if (inFlatZone && rawGettingWorse) return 0;
    if (!inFlatZone && (weightTooSmall || weightTooLarge) && weightImproving) {
      return 0;
    }

    if (!inFlatZone) return 1;

    // Soft fade for near-flat slope areas
    const fade = Math.abs(slope) / 0.1;
    return Math.max(Math.min(fade, 1), 0);
  }
}
