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
  /**
   * Returns a normalized score [0, 1] indicating how suitable it is
   * to propagate error through an exponential-activated neuron.
   *
   * Exponential(x) = exp(x)
   *
   * Characteristics:
   * - Grows very rapidly: exp(36) ~ Number.MAX_SAFE_INTEGER
   * - Vanishes quickly as x → −∞
   * - Gradient = exp(x) → explodes for x > 36 and vanishes for x < -10
   *
   * This function:
   * 1. Returns 1.0 for x ∈ [−8, 20] (effective learning region)
   * 2. Fades to 0 for x < -15 or x > 36
   * 3. Allows weak propagation (0.2) if the error would push x toward center
   * 4. Applies a penalty when:
   *    - rawInput is very large
   *    - AND the weight is too small to meaningfully support propagation
   *
   * Constants (hardcoded here for simplicity):
   * - RAW_MAX = 1000
   * - WEIGHT_MIN = 1e-8
   *
   * @param rawInput Pre-activation input x
   * @param error Error signal from output layer
   * @param weight The weight of the synapse feeding into this neuron
   * @returns A float in [0, 1] indicating propagation suitability
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const safeLow = -8;
    const safeHigh = 20;
    const min = -15;
    const max = 36;

    let score: number;

    // Safe learning region
    if (rawInput >= safeLow && rawInput <= safeHigh) {
      score = 1;
    } else if (rawInput < safeLow && error > 0) {
      // Recovery: error tries to increase x from flat zone
      score = 0.2;
    } else if (rawInput > safeHigh && error < 0) {
      // Recovery: error tries to decrease x from saturation
      score = 0.2;
    } else if (rawInput > safeHigh && rawInput <= max) {
      score = 1 - (rawInput - safeHigh) / (max - safeHigh);
    } else if (rawInput < safeLow && rawInput >= min) {
      score = (rawInput - min) / (safeLow - min);
    } else {
      score = 0;
    }

    // Weight penalty logic
    const RAW_MAX = 1000;
    const WEIGHT_MIN = 1e-8;

    const weightPenalty = Math.min(1, Math.abs(weight) / WEIGHT_MIN);
    const rawPenalty = Math.min(1, RAW_MAX / Math.abs(rawInput));

    return score * weightPenalty * rawPenalty;
  }
}
