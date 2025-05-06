import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
  public static NAME = "Exponential";

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    Exponential.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = Exponential.rangeStatic;

  getName(): string {
    return Exponential.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) {
      return Exponential.rangeStatic.limit(Number.MAX_SAFE_INTEGER);
    }

    // Avoid overflow
    if (x >= 709) {
      return Number.MAX_SAFE_INTEGER;
    }

    const value = Math.exp(x);
    return Exponential.rangeStatic.limit(value);
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
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    const raw = Math.exp(x);

    // Avoid wasting effort on sub-tiny updates
    if (raw < 1e-12) return 0;

    return Math.min(raw, 50); // or 100 depending on what your system tolerates
  }

  /**
   * Calculates error for Exponential activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = exp(x)
   *   f′(x) = exp(x)
   *   f⁻¹(y) = ln(y)
   *
   * Strategy:
   *   ✅ Use derivative when safe and finite.
   *   🥽 Fallback to foggy unSquash-based error when slope overflows or vanishes.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    const rawError = targetActivation - currentActivation;

    const x = this.unSquash(currentActivation, hint);
    const slope = this.derivative(x);

    const safeSlope = Number.isFinite(slope)
      ? Math.abs(slope) < 1e-8 ? 0 : Math.min(Math.max(slope, -50), 50)
      : Math.sign(slope);

    if (safeSlope !== 0) {
      return rawError * safeSlope;
    }

    // Fallback
    const rawCurrent = this.unSquash(currentActivation, hint);
    const rawTarget = this.unSquash(targetActivation, hint);
    const error = rawTarget - rawCurrent;

    return Number.isFinite(error) ? error : 0;
  }
}
