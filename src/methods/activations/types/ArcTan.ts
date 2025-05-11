import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
      if (typeof hint === "number" && Number.isFinite(hint) && hint > 1e6) {
        return hint;
      }
      return Number.MAX_SAFE_INTEGER;
    }

    if (activation <= lower) {
      if (typeof hint === "number" && Number.isFinite(hint) && hint < -1e6) {
        return hint;
      }
      return -Number.MAX_SAFE_INTEGER;
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
   * The derivative of the ArcTan function.
   *
   * @param x The input value.
   * @returns The derivative of the ArcTan function at the given input.
   */
  derivative(x: number): number {
    return 2 / (Math.PI * (1 + x * x));
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
    const rawError = currentActivation - targetActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);

    // Always safe: derivative never zero or undefined for ArcTan
    return rawError / slope;
  }
}
