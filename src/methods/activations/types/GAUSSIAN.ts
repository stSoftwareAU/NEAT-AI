import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Gaussian Activation Function
 *
 * f(x) = exp(-x²)
 * f⁻¹(y) = ±sqrt(-ln(y))
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Gaussian_function
 */
export class GAUSSIAN implements ActivationInterface, UnSquashInterface {
  public static NAME = "GAUSSIAN";

  public readonly range: ActivationRange = new ActivationRange(
    GAUSSIAN.NAME,
    0,
    1,
  );

  getName(): string {
    return GAUSSIAN.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return this.range.low;

    // Use a safe max X beyond which exp(-x²) underflows to 0
    const safeX = Math.min(Math.abs(x), 100); // x > ~15 means exp(-x²) ~ 0

    const value = Math.exp(-Math.pow(safeX, 2));
    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // Clamp to avoid log(0)
    const safeActivation = Math.max(activation, 1e-10);
    const sqrt = Math.sqrt(-Math.log(safeActivation));

    return (hint ?? 0) < 0 ? -sqrt : sqrt;
  }

  derivative(x: number): number {
    const result = -2 * x * Math.exp(-x * x);

    // Clamp to prevent vanishing gradients and underflows
    if (!Number.isFinite(result) || Math.abs(result) < 1e-300) return 0;

    return result;
  }

  /**
   * Calculates error for GAUSSIAN activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = exp(-x²)
   *   f′(x) = -2x * exp(-x²)
   *   f⁻¹(y) = ±√(-ln(y))  ← ambiguous without sign
   *
   * Strategy:
   *   ✅ Use derivative if slope is finite and non-zero.
   *   🥽 Fallback to foggy unSquash if slope is too flat.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const slope = this.derivative(currentValue);

    if (Math.abs(slope) > 1e-8) {
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
