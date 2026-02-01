import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TAN Activation Function
 *
 * f(x) = tan(x)
 * f⁻¹(y) = atan(y) + πk, where k ∈ ℤ
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Trigonometric_functions#Tangent
 */
export class TAN
  implements ActivationInterface, UnSquashInterface, SimplifyBiasInterface {
  public mutationProbability = 2;
  public static readonly NAME = "TAN";

  public readonly range: ActivationRange = new ActivationRange(
    TAN.NAME,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return TAN.NAME;
  }

  simplifyBias(bias: number): number {
    return bias % Math.PI;
  }

  squash(x: number): number {
    const result = Math.tan(x);
    return Number.isFinite(result) ? result : 0;
  }

  unSquash(activation: number, hint?: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be finite.");
    }

    const baseValue = Math.atan(activation);

    if (hint !== undefined && Number.isFinite(hint)) {
      const difference = hint - baseValue;
      const adjustment = Math.round(difference / Math.PI) * Math.PI;
      return baseValue + adjustment;
    }

    return baseValue;
  }

  /**
   * Computes the derivative of the tangent (TAN) activation function.
   *
   * The tangent function is defined as:
   *    f(x) = tan(x)
   *
   * The derivative is:
   *    f'(x) = 1 + tan²(x)
   *
   * This function is undefined at odd multiples of π/2 due to vertical asymptotes,
   * but we cap the result to prevent instability in gradient-based methods.
   * The output is guaranteed to be finite for all finite x.
   *
   * @param x - The input value.
   * @returns The capped derivative of tan(x).
   * @throws If x is not a finite number.
   *
   * References:
   * - https://en.wikipedia.org/wiki/Tangent_function
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    const tanX = Math.tan(x);
    const d = 1 + tanX * tanX;

    // Cap derivative to avoid exploding gradients (arbitrarily chosen bounds)
    if (!Number.isFinite(d) || d > 1000) return 1000;
    return d;
  }

  /**
   * Calculates error for TAN (tangent) activation.
   *
   * Summary:
   *   f(x)   = tan(x)
   *   f′(x)  = 1 / cos²(x)
   *   f⁻¹(y) = arctan(y)
   *
   * Strategy:
   *   ✅ Use derivative unless slope is dangerously large (near asymptote)
   *   🥽 Fallback to unSquash (arctan) if slope > MAX_SAFE
   *   🔒 Clamp result to prevent exploding gradients
   *
   * Notes:
   *   - tan(x) is periodic and unbounded
   *   - Derivative explodes near x = ±π/2 ± nπ
   *   - Fallback to arctan is fast and exact
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    const MAX_SAFE_SLOPE = 1e8;

    let error: number;
    if (Math.abs(slope) < MAX_SAFE_SLOPE) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }
  /**
   * Safe Zone Adjustment for TAN
   *
   * The TAN function explodes at odd multiples of π/2, making updates near these
   * discontinuities unstable. This method evaluates the stability of the raw input
   * and weight to determine whether to backpropagate to the raw input or adjust weight instead.
   *
   * Strategy:
   * - Define safe raw input zone: ∄ (x % π) ≈ ±π/2
   * - Reject updates where raw input is too close to a vertical asymptote
   * - If weight is outside [1e-3, 1e3] and error moves weight toward safe zone → return 0
   * - Soft fade for values near unsafe zones (±0.2 around ±π/2)
   *
   * @param rawInput Raw value before squash
   * @param error Backpropagated error
   * @param weight Synapse weight
   * @returns Confidence (0–1) that rawInput should be adjusted
   */
  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;

    const π = Math.PI;
    const mod = rawInput % π;
    const distFromAsymptote = Math.abs(Math.abs(mod) - π / 2);

    const nearAsymptote = distFromAsymptote < 0.2;
    const rawGettingWorse = (mod > π / 2 && error > 0) ||
      (mod < -π / 2 && error < 0);

    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;
    const weightImproving = (weightTooSmall && weight * error > 0) ||
      (weightTooLarge && weight * error < 0);

    if (nearAsymptote && rawGettingWorse) return 0;
    if (
      !nearAsymptote && (weightTooSmall || weightTooLarge) && weightImproving
    ) return 0;

    // Soft fade if near π/2 mod
    if (distFromAsymptote < 0.5) {
      return 1 - (0.5 - distFromAsymptote) * 2;
    }

    return 1;
  }
}
