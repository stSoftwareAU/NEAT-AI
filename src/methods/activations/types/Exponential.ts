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
   * Heuristic for determining whether it is safe and productive to propagate error
   * upstream to the source neuron for the Exponential squash function.
   *
   * Exponential grows rapidly for large raw inputs:
   *   f(x) = e^x → [~0, ∞)
   *
   * Ideal raw input range (safe zone): [-10, 30]
   *   - Below -10: output vanishes, gradient vanishes
   *   - Above 30: output explodes, gradient vanishes
   *
   * This function returns a value between 0 and 1:
   *   - 1 means safe and desirable to backpropagate
   *   - 0 means it's better to adjust weights/biases instead
   *   - Values between 0–1 create a soft fade zone
   *
   * Return 0 if:
   *   1. The raw input is outside the safe zone, and the direction of error would worsen it.
   *   2. The weight is out of safe bounds and the error would adjust it *towards* the safe range.
   *
   * These cases signal that raw input adjustment is either unhelpful or costly,
   * and weight tuning is the better route.
   *
   * @param rawInput - The current value input into the activation function.
   * @param error - The direction and magnitude of desired adjustment.
   * @param weight - The synapse weight linking this neuron.
   * @returns A number between 0–1 representing how favorable it is to propagate upstream.
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    // Safe zone for Exponential raw input
    const safeMin = -10;
    const safeMax = 30;
    const inSafeRaw = rawInput >= safeMin && rawInput <= safeMax;

    // Check if pushing raw input would make it worse
    const rawGettingWorse = (rawInput < safeMin && error < 0) ||
      (rawInput > safeMax && error > 0);

    // Safe weight bounds
    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;
    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;

    // Is weight improvement in direction of error?
    const weightImproves = (weightTooSmall && weight * error > 0) || // growing small weight
      (weightTooLarge && weight * error < 0); // shrinking big weight

    // Fallback to weight adjustment
    if (!inSafeRaw && rawGettingWorse) return 0;
    if (inSafeRaw && (weightTooSmall || weightTooLarge) && weightImproves) {
      return 0;
    }

    // Default logic (fade outside the soft safe zone)
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
