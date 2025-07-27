import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Gaussian Error Linear Unit (GELU) Activation Function
 *
 * GELU is approximated as:
 *   f(x) = 0.5 * x * (1 + tanh(√(2/π) * (x + 0.044715 * x³)))
 *
 * GELU is smooth and differentiable, commonly used in Transformer models.
 * Reference:
 * https://arxiv.org/abs/1606.08415
 */
export class GELU implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 34;
  public static readonly NAME = "GELU";
  private static readonly CUBIC_COEF = 0.044715;
  private static readonly MAX_ITERATIONS = 100;
  private static readonly TOLERANCE = 1e-6;
  private static readonly MAX_X = 10;

  public readonly range = new ActivationRange(
    GELU.NAME,
    -0.17,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return GELU.NAME;
  }

  squash(x: number): number {
    // For very large negative values, return a very small negative number
    if (x < -GELU.MAX_X) return -0;

    // For very large positive values, return the input
    if (x > GELU.MAX_X) return this.range.limit(x, x);

    // Standard GELU approximation
    const value = 0.5 * x *
      (1 +
        Math.tanh(
          Math.sqrt(2 / Math.PI) * (x + GELU.CUBIC_COEF * Math.pow(x, 3)),
        ));

    return this.range.limit(value, x);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (Math.abs(activation) < 1e-10) {
      return hint ?? -10;
    }

    let x = hint ?? (activation < 0.5 ? -1 : 1);

    for (let i = 0; i < GELU.MAX_ITERATIONS; i++) {
      const fx = this.squash(x) - activation;

      if (Math.abs(fx) < GELU.TOLERANCE) {
        break;
      }

      const derivative = this.derivative(x);
      if (Math.abs(derivative) < 1e-10) {
        if (Math.abs(fx) < 0.1) return x;
        break;
      }

      const nextX = x - fx / derivative;
      if (!Number.isFinite(nextX) || Math.abs(nextX) > GELU.MAX_X) {
        x = hint ?? 0;
        break;
      }

      x = nextX;
    }

    return x;
  }

  derivative(x: number): number {
    const inner = Math.sqrt(2 / Math.PI) * (x + 0.044715 * Math.pow(x, 3));
    const tanhInner = Math.tanh(inner);

    const cdf = 0.5 * (1 + tanhInner);
    const pdf = (0.5 * x * (1 - tanhInner * tanhInner)) *
      Math.sqrt(2 / Math.PI) *
      (1 + 3 * 0.044715 * x * x);

    const result = cdf + pdf;

    // Minimal safeguard (no clamping) to ensure finite numeric output
    return Number.isFinite(result) ? result : 0;
  }

  /**
   * Calculates error for GELU (Gaussian Error Linear Unit) activation.
   *
   * Summary:
   *   f(x) ≈ 0.5 * x * (1 + tanh(√(2/π) * (x + 0.044715 * x³)))
   *
   * Strategy:
   *   ✅ Always use derivative — smooth and nonzero
   *   ❌ No fallback — inverse does not exist in closed form
   *   🔒 Clamp result to prevent large updates
   *
   * Notes:
   *   - GELU derivative is stable and behaves well across input space
   *   - No risk of slope = 0 in typical input ranges
   *   - Derivative is faster than unSquash and only option
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    const error = rawError / slope;

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * GELU (Gaussian Error Linear Unit) Safe Zone Adjustment
   *
   * Reasoning:
   * - GELU transitions smoothly but flattens at extreme values.
   * - Safe zone for raw input is approximately [-6, 6], beyond which gradients diminish.
   * - If raw input is out of safe zone and error would worsen it, return 0.
   * - If weight is outside safe range and adjusting weight would improve, return 0.
   * - Otherwise fade or return 1.
   *
   * @param rawInput - Input to GELU function before activation
   * @param error - Propagation error
   * @param weight - Synaptic weight
   * @returns value between 0 (discourage) and 1 (safe to propagate)
   */
  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const safeMin = -6;
    const safeMax = 6;
    const inSafeRaw = rawInput >= safeMin && rawInput <= safeMax;
    const rawGettingWorse = (rawInput < safeMin && error < 0) ||
      (rawInput > safeMax && error > 0);

    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;
    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;
    const weightImproves = (weightTooSmall && weight * error > 0) ||
      (weightTooLarge && weight * error < 0);

    if (!inSafeRaw && rawGettingWorse) return 0;
    if (inSafeRaw && (weightTooSmall || weightTooLarge) && weightImproves) {
      return 0;
    }

    if (inSafeRaw) return 1;
    if (rawInput > safeMax && rawInput <= safeMax + 10) {
      return 1 - (rawInput - safeMax) / 10;
    }
    if (rawInput < safeMin && rawInput >= safeMin - 10) {
      return 1 - (safeMin - rawInput) / 10;
    }

    return 0;
  }
}
