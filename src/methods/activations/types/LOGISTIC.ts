import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
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
   * Calculates error for LOGISTIC (sigmoid) activation.
   *
   * Summary:
   *   f(x)   = 1 / (1 + e^(-x))
   *   f′(x)  = f(x) * (1 - f(x))
   *   f⁻¹(y) = ln(y / (1 - y)), valid when 0 < y < 1
   *
   * Strategy:
   *   ✅ Use derivative when slope is strong (center region)
   *   🥽 Use unSquash in tails (slope near 0)
   *   🔒 Clamp to prevent exploding weights
   *
   * Notes:
   *   - Derivative fades in tails → unsafe to trust near y ≈ 0 or 1
   *   - Inversion is exact and cheap
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = currentActivation * (1 - currentActivation);

    let error: number;
    if (slope > 1e-8) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }
}
