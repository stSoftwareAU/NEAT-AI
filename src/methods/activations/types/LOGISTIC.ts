import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * LOGISTIC (Sigmoid) Activation Function
 *
 * f(x)   = 1 / (1 + exp(-x))
 * f⁻¹(y) = log(y / (1 - y))
 *
 * Range: (0, 1)
 * Reference:
 * https://en.wikipedia.org/wiki/Sigmoid_function
 */
export class LOGISTIC implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "LOGISTIC";

  public readonly range: ActivationRange = new ActivationRange(
    LOGISTIC.NAME,
    0,
    1,
  );

  getName(): string {
    return LOGISTIC.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0.5; // avoid NaN/Inf
    const fx = 1 / (1 + Math.exp(-x));
    return this.range.limit(fx); // enforce (0, 1) safety
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const safeActivation = Math.min(
      Math.max(activation, Number.EPSILON),
      1 - Number.EPSILON,
    );

    return Math.log(safeActivation / (1 - safeActivation));
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    const y = this.squash(x);
    const d = y * (1 - y);
    return Number.isFinite(d) ? d : 0;
  }

  /**
   * Calculates error for LOGISTIC (sigmoid) activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = 1 / (1 + e^(-x))
   *   f′(x) = f(x) * (1 - f(x))
   *
   * Strategy:
   *   ✅ Uses derivative when slope is valid (not near 0 or 1).
   *   🥽 Falls back to unSquash in flat regions (slope near 0).
   *
   * Notes:
   *   - Invertible with closed-form inverse, but inversion is expensive.
   *   - Derivative is fast and accurate in the central region (0.1–0.9).
   *   - Fallback handles saturated zones where derivative underflows.
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
      const safeSlope = Math.max(Math.min(slope, 50), -50);

      return rawError * safeSlope;
    }

    // 🥽 Fallback to unSquash only if slope is ~0 (extreme x)
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;
    return Math.tanh(error);
  }
}
