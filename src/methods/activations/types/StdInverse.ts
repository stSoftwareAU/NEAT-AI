import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * StdInverse Activation Function
 *
 * f(x) = 1 / x
 * f⁻¹(y) = 1 / y
 *
 * Avoids division by near-zero and NaN. Returns 0 for input = 0.
 */
export class StdInverse implements ActivationInterface, UnSquashInterface {
  public static NAME = "StdInverse";

  public static readonly rangeStatic = new ActivationRange(
    StdInverse.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = StdInverse.rangeStatic;

  getName(): string {
    return StdInverse.NAME;
  }

  squash(x: number): number {
    // Avoid division by very small numbers that can lead to Infinity or NaN
    const safeX = Math.abs(x) < 1e-15 ? (x > 0 ? 1e-15 : -1e-15) : x;

    const value = safeX !== 0 ? 1 / safeX : 0; // 1/x, but avoid dividing by zero
    return StdInverse.rangeStatic.limit(value); // Ensure the result is within the allowed range
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (!Number.isFinite(activation) || Math.abs(activation) < 1e-15) {
      if (typeof hint === "number" && Number.isFinite(hint)) return hint;
      return activation > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
    }

    return 1 / activation;
  }

  /**
   * Derivative of standardised inverse:
   *   f(x) = 1 / (1 + |x|)
   *   f′(x) = -sign(x) / (1 + |x|)²
   */
  derivative(x: number): number {
    const absX = Math.abs(x);
    const denom = (1 + absX) ** 2;
    return -Math.sign(x) / denom;
  }

  /**
   * Calculates error for StdInverse activation using derivative or foggy fallback.
   *
   * Summary:
   *   f(x) = 1 / (1 + |x|)
   *   f′(x) = -sign(x) / (1 + |x|)²
   *
   * Strategy:
   *   ✅ Derivative works reliably everywhere.
   *   🥽 Fallback used only if slope is near-zero.
   *
   * Notes:
   *   - Invertible, smooth, and cheap to compute.
   *   - Symmetric and stable for both signs.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < 1e-10) return 0;

    const rawCurrent = this.unSquash(currentActivation, hint);
    // const slope = this.derivative(rawCurrent);

    // const safeSlope = Number.isFinite(slope)
    //   ? Math.abs(slope) < 1e-6
    //     ? 0
    //     : Math.min(Math.max(slope, -50), 50)
    //   : Math.sign(slope);

    // if (safeSlope !== 0) {
    //   return rawError * safeSlope;
    // }

    // 🕶️ Fallback
    const rawTarget = this.unSquash(targetActivation, hint);
    const error = rawTarget - rawCurrent;
    return Number.isFinite(error) ? error : 0;
  }
}
