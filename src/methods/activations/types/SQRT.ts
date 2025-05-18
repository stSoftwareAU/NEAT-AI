import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";

/**
 * SQRT Activation Function
 *
 * The SQRT function returns the non-negative square root of its input:
 *   f(x) = √x for x >= 0
 *
 * It is bounded below by 0 and unbounded above. This function is useful
 * in composite structures where root-scaling is necessary.
 *
 * Derivative:
 *   f'(x) = 1 / (2√x) for x > 0
 *
 * Error Calculation:
 * Uses derivative when slope is stable, or unSquash as fallback.
 *
 * Behavior:
 * - Monotonic
 * - Undefined for x < 0 (returns 0)
 * - Gentle slope for large x, steep near 0
 */
export class SQRT implements ActivationInterface {
  public static NAME = "SQRT";

  public readonly range = new ActivationRange(
    SQRT.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return SQRT.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x) || x < 0) return 0;
    return this.range.limit(Math.sqrt(x));
  }

  derivative(x: number): number {
    if (!Number.isFinite(x) || x <= 0) return 0;
    return 1 / (2 * Math.sqrt(x));
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);
    let sign = 1;
    if (hint !== undefined && Number.isFinite(hint)) {
      if (activation <= 0) {
        return hint;
      }
      if (hint < 0) {
        sign = -1;
      }
    }
    return Math.max(0, activation * activation) * sign;
  }

  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    let error: number;

    if (Math.abs(slope) > 1e-8) {
      const safeSlope = Math.min(Math.max(slope, -50), 50);
      error = rawError / safeSlope;
    } else {
      const targetValue = this.unSquash(targetActivation);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }
}
