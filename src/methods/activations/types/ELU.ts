import { ActivationRange } from "@propagate/ActivationRange.ts";
import { ErrorHelper } from "@propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "@methods/activations/AbstractActivationInterface.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { safeZoneAdjustment } from "@methods/activations/SafeZoneAdjustment.ts";
import type { UnSquashInterface } from "@methods/activations/UnSquashInterface.ts";

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
  public mutationProbability = 33;
  public static NAME = "ELU";

  // Common α value
  private static readonly ALPHA = 1.0;

  public readonly range = new ActivationRange(
    ELU.NAME,
    -ELU.ALPHA,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return ELU.NAME;
  }

  squash(x: number): number {
    if (Number.isNaN(x)) return 0; // guard for NaN only; let range.limit() handle Infinity
    const value = x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);
    return this.range.limit(value, x);
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
   * Calculates error for ELU (Exponential Linear Unit).
   *
   * Summary:
   *   f(x) = x              if x ≥ 0
   *        = α * (e^x - 1)  if x < 0
   *
   *   f′(x) = 1             if x ≥ 0
   *        = f(x) + α       if x < 0
   *
   * Strategy:
   *   ✅ Use derivative when slope is healthy
   *   🥽 Fallback to unSquash when derivative vanishes (very negative x)
   *   🔒 Clamp result to prevent extreme values
   *
   * Notes:
   *   - ELU derivative vanishes for very negative x (α * exp(x) → 0)
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
    if (slope > 1e-2) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    return safeZoneAdjustment(rawInput, error, weight, -10, 10);
  }
}
