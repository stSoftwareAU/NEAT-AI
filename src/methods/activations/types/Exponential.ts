import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Exponential Activation Function
 *
 * f(x) = exp(x)
 * f⁻¹(y) = log(y)  for y > 0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Exponential_function
 */
export class Exponential implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 2;
  public static NAME = "Exponential";

  public readonly range = new ActivationRange(
    Exponential.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return Exponential.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) {
      return this.range.limit(Number.MAX_SAFE_INTEGER);
    }

    // Avoid overflow
    if (x >= 36) {
      return Number.MAX_SAFE_INTEGER;
    }

    const value = Math.exp(x);
    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation <= 0 || !Number.isFinite(activation)) {
      if (typeof hint === "number" && Number.isFinite(hint)) {
        return hint;
      }
      return -20; // Conservative fallback for log(0)
    }

    return Math.log(activation);
  }

  derivative(x: number): number {
    const raw = Math.exp(x);

    // Avoid wasting effort on sub-tiny updates
    if (raw < 1e-12) return 0;

    return Math.min(raw, 50); // or 100 depending on what your system tolerates
  }

  /**
   * Calculates error for EXPONENTIAL activation with slope range checks.
   *
   * Summary:
   *   f(x)   = exp(x)
   *   f′(x)  = exp(x)
   *   f⁻¹(y) = ln(y)
   *
   * Strategy:
   *   ✅ Use derivative when slope is within safe range
   *   🥽 Fallback to unSquash if slope is too small or too large
   *   🔒 Clamp result to prevent overflow in weights
   *
   * Notes:
   *   - Slope is always positive, but can grow/shrink exponentially
   *   - Inversion is fast (ln), so safe for fallback
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    const MIN_SLOPE = 1e-8;
    const MAX_SLOPE = 1e8;

    let error: number;
    if (slope > MIN_SLOPE && slope < MAX_SLOPE) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  safeZoneAdjustment(
    rawInput: number,
    error: number,
  ): number {
    // Good range: [-8, 20]
    // Fade in from -15 to -8
    // Fade out from 20 to 35

    if (!Number.isFinite(rawInput)) return 0;

    const safeLow = -8;
    const safeHigh = 20;

    if (rawInput >= safeLow && rawInput <= safeHigh) return 1;

    // Out of bounds — check if error would move it toward the zone
    if (rawInput < safeLow && error > 0) {
      return 0.2; // small nudge toward safe zone
    }

    if (rawInput > safeHigh && error < 0) {
      return 0.2;
    }

    return 0;
  }
}
