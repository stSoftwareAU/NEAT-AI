import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ReLU6 Activation Function
 *
 * f(x) = min(max(0, x), 6)
 * f⁻¹(y) = y for 0 < y < 6
 *         = hint if y = 0 or 6 (ambiguous region)
 *
 * Reference:
 * https://www.tensorflow.org/api_docs/python/tf/nn/relu6
 */
export class ReLU6
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static readonly NAME = "ReLU6";

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    ReLU6.NAME,
    0,
    6,
  );

  public readonly range = ReLU6.rangeStatic;

  getName(): string {
    return ReLU6.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.min(Math.max(0, (${value})), 6)`;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const value = Math.min(Math.max(0, x), 6);
    return ReLU6.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0 && activation < 6) {
      return activation;
    }

    if (activation === 6 && typeof hint === "number" && Number.isFinite(hint)) {
      return hint > 6 ? hint : 6;
    }

    if (activation === 0 && typeof hint === "number" && Number.isFinite(hint)) {
      return hint < 0 ? hint : 0;
    }

    return 0; // Default fallback when no hint is given
  }

  /**
   * The derivative of the ReLU6 function.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    return x > 0 && x < 6 ? 1 : 0;
  }

  /**
   * Calculates error for ReLU6 activation using piecewise logic.
   *
   * Summary:
   *   f(x) = min(max(0, x), 6)
   *   f′(x) = 0 if x ≤ 0 or x ≥ 6; 1 if 0 < x < 6
   *
   * Strategy:
   *   ✅ Use slope = 1 if inside active zone.
   *   🥽 Fallback to foggy unSquash if in dead zones (slope = 0).
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = (currentValue > 0 && currentValue < 6) ? 1 : 0;

    if (slope > 0) {
      return rawError;
    }

    // Fallback when slope = 0
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;
    return Math.tanh(error);
  }
}
