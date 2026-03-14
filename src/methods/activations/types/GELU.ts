import { ActivationRange } from "@propagate/ActivationRange.ts";
import { ErrorHelper } from "@propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import { safeZoneAdjustment } from "../SafeZoneAdjustment.ts";
import { NR_MAX_ITERATIONS, NR_TOLERANCE } from "../NewtonRaphsonConstants.ts";
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
  private static readonly MAX_ITERATIONS = NR_MAX_ITERATIONS;
  private static readonly TOLERANCE = NR_TOLERANCE;
  private static readonly MAX_X = 10;
  private static readonly SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI);

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
          GELU.SQRT_2_OVER_PI * (x + GELU.CUBIC_COEF * x * x * x),
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
    const inner = GELU.SQRT_2_OVER_PI * (x + 0.044715 * x * x * x);
    const tanhInner = Math.tanh(inner);

    const cdf = 0.5 * (1 + tanhInner);
    const pdf = (0.5 * x * (1 - tanhInner * tanhInner)) *
      GELU.SQRT_2_OVER_PI *
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
   *   ✅ Use derivative when slope is healthy
   *   🥽 Fallback to unSquash when derivative vanishes (extreme inputs)
   *   🔒 Clamp result to prevent large updates
   *
   * Notes:
   *   - GELU derivative vanishes for large negative x
   *   - Fallback prevents exploding/zero error in saturation regions
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
    if (Math.abs(slope) > 1e-2) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    return safeZoneAdjustment(rawInput, error, weight, -6, 6);
  }
}
