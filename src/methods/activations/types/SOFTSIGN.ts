import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softsign Activation Function
 *
 * f(x) = x / (1 + |x|)
 * f⁻¹(y) = y / (1 - |y|)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Comparison_of_activation_functions
 */
export class SOFTSIGN implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 22;
  public static readonly NAME = "SOFTSIGN";
  private static readonly LIMIT = 0.99;

  public readonly range: ActivationRange = new ActivationRange(
    SOFTSIGN.NAME,
    -SOFTSIGN.LIMIT,
    SOFTSIGN.LIMIT,
  );

  getName(): string {
    return SOFTSIGN.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;

    const d = 1 + Math.abs(x);
    const value = x / d;

    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const denom = 1 - Math.abs(activation);

    if (denom <= 1e-8 || !Number.isFinite(denom)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
    }

    return activation / denom;
  }

  /**
   * The derivative of the softsign function.
   *
   * @param x The input value.
   * @returns The derivative of the softsign function at the given input.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    const denom = 1 + Math.abs(x);
    return 1 / (denom * denom);
  }

  /**
   * Calculates error for SOFTSIGN activation.
   *
   * Summary:
   *   f(x)   = x / (1 + |x|)
   *   f′(x)  = 1 / (1 + |x|)^2
   *   f⁻¹(y) = y / (1 − |y|), valid for |y| < 1
   *
   * Strategy:
   *   ✅ Use derivative when slope is stable
   *   🥽 Fallback to unSquash when slope is very small
   *   🔒 Clamp result to avoid large weight changes
   *
   * Notes:
   *   - Derivative fades in tails (large |x|)
   *   - Inversion is safe for |y| < 1
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);

    let error: number;
    if (slope > 1e-8) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * Safe Zone Adjustment for SOFTSIGN
   *
   * The SOFTSIGN function has diminishing gradients for large |x| (i.e., derivative ≈ 0),
   * leading to ineffective backpropagation. This method helps determine whether to adjust
   * the raw input or the synapse weight.
   *
   * Strategy:
   * - Prefer raw propagation when input is within [-10, 10] (strong slope region)
   * - If input is outside this region and error would push it further out, return 0
   * - If weight is too small/large and adjusting it brings it closer to normal range, prefer weight update
   * - Apply soft fading for inputs near the transition boundaries
   *
   * @param rawInput Pre-squash value
   * @param error Backpropagated error
   * @param weight Synapse weight
   * @returns Confidence score (0–1) whether raw propagation should be used
   */
  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;

    const safeMin = -10;
    const safeMax = 10;
    const inSafeRange = rawInput >= safeMin && rawInput <= safeMax;

    const rawGettingWorse = (rawInput < safeMin && error < 0) ||
      (rawInput > safeMax && error > 0);

    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;
    const weightImproving = (weightTooSmall && weight * error > 0) ||
      (weightTooLarge && weight * error < 0);

    if (!inSafeRange && rawGettingWorse) return 0;
    if (inSafeRange && (weightTooSmall || weightTooLarge) && weightImproving) {
      return 0;
    }

    if (inSafeRange) return 1;

    // Soft fade near edge zones
    if (rawInput > safeMax && rawInput <= safeMax + 10) {
      return 1 - (rawInput - safeMax) / 10;
    }
    if (rawInput < safeMin && rawInput >= safeMin - 10) {
      return 1 - (safeMin - rawInput) / 10;
    }

    return 0;
  }
}
