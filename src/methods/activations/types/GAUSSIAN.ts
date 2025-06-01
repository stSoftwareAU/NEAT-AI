import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Gaussian Activation Function
 *
 * f(x) = exp(-x²)
 * f⁻¹(y) = ±sqrt(-ln(y))
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Gaussian_function
 */
export class GAUSSIAN implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 10;
  public static NAME = "GAUSSIAN";

  public readonly range: ActivationRange = new ActivationRange(
    GAUSSIAN.NAME,
    0,
    1,
  );

  getName(): string {
    return GAUSSIAN.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return this.range.low;

    // Use a safe max X beyond which exp(-x²) underflows to 0
    const safeX = Math.min(Math.abs(x), 100); // x > ~15 means exp(-x²) ~ 0

    const value = Math.exp(-Math.pow(safeX, 2));
    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // Clamp to avoid log(0)
    const safeActivation = Math.max(activation, 1e-10);
    const sqrt = Math.sqrt(-Math.log(safeActivation));

    return (hint ?? 0) < 0 ? -sqrt : sqrt;
  }

  derivative(x: number): number {
    const result = -2 * x * Math.exp(-x * x);

    // Clamp to prevent vanishing gradients and underflows
    if (!Number.isFinite(result) || Math.abs(result) < 1e-300) return 0;

    return result;
  }

  /**
   * Calculates error for GAUSSIAN activation using derivative with fallback.
   *
   * Summary:
   *   f(x)   = exp(-x²)
   *   f′(x)  = -2x * exp(-x²)
   *   f⁻¹(y) = ±√(-ln(y))
   *
   * Strategy:
   *   ✅ Use derivative when slope is nonzero
   *   🥽 Fallback to unSquash and choose ±√(-ln(y)) closest to currentValue
   *   🔒 Clamp error to avoid extreme weight updates
   *
   * Notes:
   *   - Slope is 0 at x = 0 (peak), and fades quickly in tails
   *   - UnSquash is ambiguous — fallback must resolve sign based on currentValue
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
    if (Math.abs(slope) > 1e-8) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * GAUSSIAN Safe Zone Adjustment Logic
   *
   * The GAUSSIAN activation peaks at x=0 and quickly decays toward 0 for large |x|.
   * This makes it only effective when the raw input is near 0.
   *
   * Strategy:
   * - Only allow propagation when raw input is close to 0: ∈ [−3, 3]
   * - If raw input is far and error would push it even further, disallow propagation
   * - If weight is far out of bounds and error would bring it back toward the safe range, disallow propagation to allow weight fix
   * - Smooth fade as we move out of ideal zone
   *
   * @param rawInput Raw pre-activation input
   * @param error Back propagated error
   * @param weight Synapse weight
   * @returns A float from 0 (don't propagate) to 1 (freely propagate)
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const absRaw = Math.abs(rawInput);
    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;

    const inSafeZone = absRaw <= 3;

    const rawGettingWorse = (rawInput < -3 && error < 0) ||
      (rawInput > 3 && error > 0);

    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;
    const weightImproving = (weightTooSmall && weight * error > 0) ||
      (weightTooLarge && weight * error < 0);

    if (!inSafeZone && rawGettingWorse) return 0;
    if (inSafeZone && (weightTooSmall || weightTooLarge) && weightImproving) {
      return 0;
    }

    if (inSafeZone) return 1;
    if (absRaw <= 6) return 1 - (absRaw - 3) / 3;

    return 0;
  }
}
