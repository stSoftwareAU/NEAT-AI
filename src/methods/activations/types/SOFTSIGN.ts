import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softsign Activation Function
 *
 * f(x) = x / (1 + |x|)
 * f⁻¹(y) = y / (1 - |y|)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Comparison_of_activation_functions
 */
export class SOFTSIGN implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "SOFTSIGN";
  private static readonly LIMIT = 0.99;

  public readonly range: ActivationRange = new ActivationRange(
    SOFTSIGN.NAME,
    -SOFTSIGN.LIMIT,
    SOFTSIGN.LIMIT,
  );

  getName(): string {
    return SOFTSIGN.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;

    const d = 1 + Math.abs(x);
    const value = x / d;

    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const denom = 1 - Math.abs(activation);

    if (denom <= 1e-8 || !Number.isFinite(denom)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
    }

    return activation / denom;
  }

  /**
   * The derivative of the softsign function.
   *
   * @param x The input value.
   * @returns The derivative of the softsign function at the given input.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    const denom = 1 + Math.abs(x);
    return 1 / (denom * denom);
  }

  /**
   * Calculates error for SoftSign activation using derivative or fallback.
   *
   * Summary:
   *   f(x)       = x / (1 + |x|)
   *   f′(x)      = 1 / (1 + |x|)^2
   *   Inverse    = y / (1 - |y|)
   *
   * Strategy:
   *   ✅ Use derivative when slope is stable.
   *   🥽 Fallback to unSquash (raw-space error) if slope is near zero or non-finite.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;
    const slope = this.derivative(currentValue);

    if (Math.abs(slope) > 1e-8) {
      const safeSlope = Math.min(Math.max(slope, -50), 50);
      return rawError * safeSlope;
    }

    // 🥽 Fallback to foggy glasses
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;

    return Math.tanh(error);
  }
}
