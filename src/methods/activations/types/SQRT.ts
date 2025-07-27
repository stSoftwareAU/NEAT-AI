import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";

/**
 * SQRT Activation Function
 *
 * The SQRT function returns the non-negative square root of its input:
 *   f(x) = √x for x >= 0
 *
 * It is bounded below by 0 and unbounded above. This function is useful
 * in composite structures where root-scaling is necessary.
 *
 * Derivative:
 *   f'(x) = 1 / (2√x) for x > 0
 *
 * Error Calculation:
 * Uses derivative when slope is stable, or unSquash as fallback.
 *
 * Behavior:
 * - Monotonic
 * - Undefined for x < 0 (returns 0)
 * - Gentle slope for large x, steep near 0
 */
export class SQRT implements ActivationInterface {
  public mutationProbability = 1;
  public static NAME = "SQRT";

  public readonly range = new ActivationRange(
    SQRT.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return SQRT.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x) || x < 0) return 0;

    return this.range.limit(Math.sqrt(x), x);
  }

  derivative(x: number): number {
    if (!Number.isFinite(x) || x <= 0) return 0;
    return 1 / (2 * Math.sqrt(x));
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);
    let sign = 1;
    if (hint !== undefined && Number.isFinite(hint)) {
      if (activation <= 0) {
        return hint;
      }
      if (hint < 0) {
        sign = -1;
      }
    }
    return Math.max(0, activation * activation) * sign;
  }

  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    let error: number;

    if (Math.abs(slope) > 1e-8) {
      const safeSlope = Math.min(Math.max(slope, -50), 50);
      error = rawError / safeSlope;
    } else {
      const targetValue = this.unSquash(targetActivation);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * Guides the backpropagation engine on whether it's safe or beneficial
   * to adjust the input neuron for the SQRT squash function.
   *
   * ### Behavior:
   * - Full confidence (`1`) when `rawInput` ∈ [0.01, 10]
   * - Partial allowance (`0.3`) for recovering from invalid values (`rawInput` ≈ 0 or < 0)
   * - Linear fadeout between 10–20 as gradients weaken
   * - No adjustment encouragement (`0`) when:
   * - input is negative and error is negative
   * - input is very large and flat (x > 20)
   *
   * ### Rationale:
   * - SQRT(x) is only defined for x ≥ 0
   * - Large x values produce small gradients → poor training effect
   * - This logic:
   * - Encourages movement into the domain if beneficial (e.g., error > 0 at x ≈ 0)
   * - Discourages useless or invalid movement
   * - Pushes weight/bias instead of raw input when out of range
   *
   * ### Notes:
   * - `weight` is not currently used, but passed to maintain API consistency
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    _weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    // SQRT is undefined for x < 0; never propagate toward negatives
    if (rawInput < 0 && error < 0) return 0;

    // Strong incentive to stay in a stable gradient zone: x ∈ [0.01, 10]
    if (rawInput >= 0.01 && rawInput <= 10) return 1;

    // If we're below safe zone and trying to go up (into domain), allow it
    if (rawInput < 0.01 && error > 0) return 0.3;

    // Fade zone: x ∈ [10, 20] — flatter gradients, lower gain
    if (rawInput > 10 && rawInput <= 20) {
      return 1 - (rawInput - 10) / 10;
    }

    // Above 20, gradients are too flat; prefer weight/bias adjustment
    return 0;
  }
}
