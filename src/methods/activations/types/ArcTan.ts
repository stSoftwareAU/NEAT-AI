import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    return 2 / (Math.PI * (1 + x * x));
  }

  /**
   * Calculate the error based on the current and target activations.
   *
   * @param currentActivation The current activation value.
   * @param targetActivation The target activation value.
   * @param hint Optional hint for unSquash.
   * @returns The calculated error.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    const rawError = targetActivation - currentActivation;

    const hasHint = Number.isFinite(hint);
    let x: number | undefined = hasHint ? hint : undefined;

    if (!hasHint) {
      try {
        x = this.unSquash(currentActivation);
      } catch {
        x = undefined;
      }
    }

    if (x !== undefined) {
      const slope = this.derivative(x);
      const safeSlope = Number.isFinite(slope)
        ? Math.abs(slope) < 1e-8 ? 0 : Math.min(Math.max(slope, -50), 50)
        : Math.sign(slope);

      if (safeSlope !== 0) {
        return rawError * safeSlope;
      }
    }

    // 🥽 Fallback: foggy glasses (inverse-based)
    const raw = this.unSquash(currentActivation, hint);
    const targetRaw = this.unSquash(targetActivation, hint);
    const error = targetRaw - raw;

    return Number.isFinite(error) ? error : 0;
  }
}
