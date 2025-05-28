import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bent Identity (BENT_IDENTITY) activation function.
 *
 * f(x) = (sqrt(x^2 + 1) - 1)/2 + x
 * f'(x) = x / (2 * sqrt(x^2 + 1)) + 1
 *
 * unSquash uses Newton-Raphson, with an optional hint to improve convergence.
 */
export class BENT_IDENTITY implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 3;
  public static NAME = "BENT_IDENTITY";
  private static readonly MAX_ITERATIONS = 100;
  private static readonly EPSILON = 1e-6;
  private static readonly OVERFLOW_LIMIT = 1e153;

  private static rangeStatic: ActivationRange = new ActivationRange(
    BENT_IDENTITY.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range: ActivationRange = BENT_IDENTITY.rangeStatic;

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    let x = (typeof hint === "number" && Number.isFinite(hint))
      ? hint
      : activation; // fallback guess if hint isn't usable

    for (let i = 0; i < BENT_IDENTITY.MAX_ITERATIONS; i++) {
      if (Math.abs(x) >= BENT_IDENTITY.OVERFLOW_LIMIT) {
        return x; // return best guess if diverging
      }

      const d = Math.sqrt(x * x + 1);
      const fx = (d - 1) / 2 + x - activation;
      if (Math.abs(fx) < BENT_IDENTITY.EPSILON) {
        break;
      }

      const dfx = x / (2 * d) + 1;
      x -= fx / dfx;
    }

    return x;
  }

  getName(): string {
    return BENT_IDENTITY.NAME;
  }

  squash(x: number): number {
    if (Math.abs(x) >= BENT_IDENTITY.OVERFLOW_LIMIT) {
      return BENT_IDENTITY.rangeStatic.limit(x);
    }

    const d = Math.sqrt(x * x + 1);
    const value = (d - 1) / 2 + x;
    return BENT_IDENTITY.rangeStatic.limit(value);
  }

  /**
   * Derivative of the Bent Identity function.
   * Returns x / (2 * sqrt(x^2 + 1)) + 1.
   * @param x The input value.
   * @returns The derivative value.
   */
  derivative(x: number): number {
    return x / (2 * Math.sqrt(x * x + 1)) + 1;
  }

  /**
   * Calculates error for BENT_IDENTITY activation using derivative only.
   *
   * Summary:
   *   f(x) = (√(x² + 1) - 1)/2 + x
   *   f′(x) = x / (2√(x² + 1)) + 1
   *
   * Strategy:
   *   ✅ Always use derivative — slope is continuous, smooth, and non-zero.
   *   ❌ No fallback needed — unSquash is valid but unnecessary.
   *
   * Notes:
   *   - Bent Identity is fully invertible and differentiable.
   *   - Derivative remains ≥ 1 across the entire domain, ensuring learning signal.
   *   - Derivative-based error propagation is preferred for speed and simplicity.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    return ErrorHelper.calculateClampedError(rawError / slope);
  }

  /**
   * Estimates the safety and usefulness of adjusting the raw input
   * for a neuron using the `BENT_IDENTITY` activation function.
   *
   * `BENT_IDENTITY`:
   *   f(x) = (√(x² + 1) - 1)/2 + x
   *
   * This is a mostly-linear function with a gentle nonlinearity.
   *
   * ### Behavior:
   * - Strong zone: x ∈ [−10, 10] where gradients ≈ 1
   * - Recovery zone: allow nudges back toward the center
   * - Fadeout: gradually reduce adjustment confidence in [10, 20]
   * - Saturation zone: discourage input changes if already far from origin
   *
   * ### Rationale:
   * - Keeps activations in range where gradient is strongest and stable
   * - Avoids wasting effort on very large inputs (≈ linear, low impact)
   * - Bias/weight tuning is preferred beyond the soft boundary
   *
   * ### Notes:
   * - `weight` unused here but passed for interface compatibility
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    _weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const abs = Math.abs(rawInput);

    // Safe/strong zone: x ∈ [−10, 10] is nearly linear
    if (abs <= 10) return 1;

    // Allow recovery if error is pulling us back toward center
    if (rawInput > 10 && error < 0) return 0.3;
    if (rawInput < -10 && error > 0) return 0.3;

    // Fade between 10 and 20
    if (abs <= 20) return 1 - (abs - 10) / 10;

    return 0;
  }
}
