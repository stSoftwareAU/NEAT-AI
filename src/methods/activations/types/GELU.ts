import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
    if (x > GELU.MAX_X) return this.range.limit(x);

    // Standard GELU approximation
    const value = 0.5 * x *
      (1 +
        Math.tanh(
          Math.sqrt(2 / Math.PI) * (x + GELU.CUBIC_COEF * Math.pow(x, 3)),
        ));

    return this.range.limit(value);
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
   * Calculates error for GELU (Gaussian Error Linear Unit) using the derivative.
   *
   * Summary:
   *   f(x) ≈ 0.5 * x * (1 + tanh(√(2/π) * (x + 0.044715 * x³)))
   *   f′(x) is smooth, always finite, and never zero across real numbers.
   *
   * Strategy:
   *   ✅ Uses the derivative directly — fast, smooth, and safe.
   *   ❌ No fallback needed or used — unSquash is expensive and unnecessary.
   *
   * Notes:
   *   - GELU derivative is stable and non-zero everywhere.
   *   - Clamping protects against exploding gradients at large x.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;

    const slope = this.derivative(currentValue);

    const safeSlope = Number.isFinite(slope)
      ? Math.abs(slope) < 1e-8 ? 0 : Math.min(Math.max(slope, -50), 50)
      : Math.sign(slope);

    return rawError * safeSlope;
  }
}
