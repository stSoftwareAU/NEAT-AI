import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ArcTan (Inverse Tangent) Activation Function
 *
 * f(x) = atan(x), range: (-π/2, π/2)
 * f⁻¹(y) = tan(y)
 * Derivative: 1 / (1 + x²)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Inverse_trigonometric_functions#Arctangent
 */
export class ArcTan
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public mutationProbability = 23;
  public static NAME = "ArcTan";

  private static readonly EPSILON = 1e-5;
  private static readonly rangeStatic = new ActivationRange(
    ArcTan.NAME,
    -Math.PI / 2,
    Math.PI / 2,
  );

  public readonly range: ActivationRange = ArcTan.rangeStatic;

  inlineSquash(value: string): string {
    return `Math.atan(${value})`;
  }

  squash(x: number): number {
    return Math.atan(x);
  }

  unSquash(activation: number, hint?: number): number {
    ArcTan.rangeStatic.validate(activation, hint);

    const upper = Math.PI / 2 - ArcTan.EPSILON;
    const lower = -Math.PI / 2 + ArcTan.EPSILON;

    if (activation >= upper) {
      // ArcTan never truly reaches +π/2 for finite inputs.
      // If we are asked to invert a saturated activation (often due to clamping),
      // prefer the smallest-change solution by returning the current raw value.
      // This prevents record/discovery paths from generating astronomical errors
      // (eg. 1e12+) that dominate MSE and slow evolution dramatically.
      if (typeof hint === "number" && Number.isFinite(hint)) {
        return hint;
      }
      // Fallback to a large but *finite* value if no hint is available.
      return 1e6;
    }

    if (activation <= lower) {
      if (typeof hint === "number" && Number.isFinite(hint)) {
        return hint;
      }
      return -1e6;
    }

    const value = Math.tan(activation);
    if (!Number.isFinite(value)) {
      throw new Error(
        `ArcTan unSquash(${activation}) → non-finite result: ${value}`,
      );
    }

    return value;
  }

  getName(): string {
    return ArcTan.NAME;
  }

  /**
   * Derivative of arctangent function:
   * f(x) = arctan(x)
   * f′(x) = 1 / (1 + x²)
   */
  derivative(x: number): number {
    return 1 / (1 + x * x);
  }

  /**
   * Calculates error for ArcTan activation using derivative-based strategy.
   *
   * Summary:
   *   f(x) = arctangent(x)
   *   f′(x) = 1 / (1 + x²)
   *
   * Strategy:
   *   ✅ Always use derivative (slope is finite and non-zero).
   *   ❌ No fallback required — ArcTan is smooth and invertible with no dead zones.
   *
   * Notes:
   *   - Error is scaled by inverse of slope to estimate pre-activation delta.
   *   - Derivative shrinks for large |x|, but never reaches zero.
   *   - ArcTan is well-suited for derivative-based error propagation.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);

    // Always safe: derivative never zero or undefined for ArcTan
    return ErrorHelper.calculateClampedError(rawError / slope);
  }

  /**
   * Determines how safe or beneficial it is to adjust the input value
   * during backpropagation when using the `ArcTan` squash function.
   *
   * ArcTan is a smooth, saturating function:
   *   - Gradients are strong near x = 0
   *   - Gradients flatten as |x| → ∞
   *
   * ### Behavior:
   * - Returns `1` inside the strong gradient zone x ∈ [−2, 2]
   * - Allows recovery toward the center if the error is pulling in that direction
   * - Gradually fades to `0` for |x| ∈ [2, 4]
   * - Completely avoids updates when input is far into saturation
   *
   * ### Rationale:
   * - Encourages error correction in the high-sensitivity region
   * - Discourages pushing already-saturated neurons further
   * - Allows correction of runaway weights using bias/weight paths instead
   *
   * ### Notes:
   * - `weight` is included for API consistency, but unused
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    _weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const abs = Math.abs(rawInput);

    // Ideal gradient zone: roughly x ∈ [−2, 2]
    if (abs <= 2) return 1;

    // Recovery zone: allow updates that move toward center
    if (rawInput > 2 && error < 0) return 0.3;
    if (rawInput < -2 && error > 0) return 0.3;

    // Fade zone: x ∈ [2, 4]
    if (abs <= 4) return 1 - (abs - 2) / 2;

    // Out of bounds: too flat for meaningful updates
    return 0;
  }
}
