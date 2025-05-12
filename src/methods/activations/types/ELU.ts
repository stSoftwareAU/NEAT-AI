import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Exponential Linear Unit (ELU) Activation Function
 *
 * f(x) = x if x > 0
 *      = α * (exp(x) - 1) if x <= 0
 *
 * Inverse: x = log(y / α + 1) for y <= 0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#ELU
 */
export class ELU implements ActivationInterface, UnSquashInterface {
  public static NAME = "ELU";

  // Common α value
  private static readonly ALPHA = 1.0;

  public static readonly rangeStatic = new ActivationRange(
    ELU.NAME,
    -ELU.ALPHA,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = ELU.rangeStatic;

  getName(): string {
    return ELU.NAME;
  }

  squash(x: number): number {
    const value = x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);
    return ELU.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    }

    // Ensure safe input to log()
    const ratio = activation / ELU.ALPHA + 1;

    if (ratio <= 0) {
      // Use hint if inverse would explode
      if (typeof hint === "number" && Number.isFinite(hint)) {
        return hint;
      }
      return -20; // conservative fallback
    }

    return Math.log(ratio);
  }

  derivative(x: number): number {
    // ELU derivative: 1 if x ≥ 0, else (f(x) + α)
    return x >= 0 ? 1 : this.squash(x) + ELU.ALPHA;
  }

  /**
   * Calculates error for ELU (Exponential Linear Unit) using derivative only.
   *
   * Summary:
   *   f(x) = x              if x ≥ 0
   *        = α * (e^x - 1)  if x < 0
   *
   *   f′(x) = 1             if x ≥ 0
   *        = f(x) + α       if x < 0
   *
   * Strategy:
   *   ✅ Always use derivative — slope is always defined and non-zero
   *   ❌ No fallback required
   *   🔒 Clamp result to prevent extreme values
   *
   * Notes:
   *   - ELU is smooth and avoids dead zones like ReLU.
   *   - UnSquash is complex and unnecessary; derivative is fast and safe.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = currentActivation - targetActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    const error = rawError / slope;

    return ErrorHelper.calculateClampedError(error);
  }
}
