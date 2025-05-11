import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class LeakyReLU implements ActivationInterface, UnSquashInterface {
  public static NAME = "LeakyReLU";

  public static readonly ALPHA = 0.01;

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    LeakyReLU.NAME,
    Number.MIN_SAFE_INTEGER * LeakyReLU.ALPHA,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = LeakyReLU.rangeStatic;

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return activation > 0 ? activation : activation / LeakyReLU.ALPHA;
  }

  getName() {
    return LeakyReLU.NAME;
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    return x >= 0 ? 1 : LeakyReLU.ALPHA;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0; // <- guard for NaN or Infinity
    const value = x > 0 ? x : LeakyReLU.ALPHA * x;
    return LeakyReLU.rangeStatic.limit(value);
  }

  /**
   * Calculates error for LeakyReLU activation using derivative.
   *
   * Summary:
   *   f(x) = x       if x ≥ 0
   *        = α * x  if x < 0
   *   f′(x) = 1      if x ≥ 0
   *        = α      if x < 0
   *
   * Strategy:
   *   ✅ Always uses derivative: slope is never zero.
   *   ✅ Invertible with closed-form unSquash: used as fallback if derivative fails.
   *   ✅ Fast and accurate in all regions.
   *
   * This is a high-performance, stable function with no dead zones.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);

    return rawError / slope;
  }
}
