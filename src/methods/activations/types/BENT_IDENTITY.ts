import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
   * Calculates error for BENT_IDENTITY activation using derivative or foggy fallback.
   *
   * Summary:
   *   f(x) = (√(x² + 1) - 1)/2 + x
   *   f′(x) = x / (2√(x² + 1)) + 1
   *
   * Strategy:
   *   ✅ Uses derivative if slope is finite and significant.
   *   🥽 Falls back to foggy (unSquash) if slope is flat or diverges.
   *
   * Notes:
   *   - Fully invertible and numerically stable.
   *   - Derivative is smooth and rarely zero — often preferred.
   *   - Inversion is cheap, so fallback is also viable.
   *   - Safe to use either method based on performance preference.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const slope = this.derivative(currentValue);

    if (Number.isFinite(slope) && Math.abs(slope) > 1e-8) {
      const safeSlope = Math.min(Math.max(slope, -50), 50);
      const rawError = targetActivation - currentActivation;
      return rawError * safeSlope;
    }

    // 🥽 Fallback to foggy glasses
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;

    return Math.tanh(error);
  }
}
