import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
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
export class ReLU6 implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 3;
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

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const value = Math.min(Math.max(0, x), 6);
    return ReLU6.rangeStatic.limit(value, x);
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
   * Calculates error for ReLU6 using unSquash only.
   *
   * Summary:
   *   f(x) = clamp(x, 0, 6)
   *   f⁻¹(y) = y (clamped), always defined
   *
   * Strategy:
   *   🎯 Always use unSquash — it's cheap and safe
   *   🔒 Clamp result to avoid extreme updates
   */
  calculateError(
    _currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;

    return ErrorHelper.calculateClampedError(error);
  }
  /**
   * Indicates how suitable it is to propagate error through a ReLU6 neuron.
   *
   * ReLU6 is a capped linear function:
   *    f(x) = 0 when x ≤ 0
   *         = x when 0 < x < 6
   *         = 6 when x ≥ 6
   *
   * Safe propagation occurs in the linear zone. Recovery is allowed from the
   * saturation zones if the error direction would push back into the linear region.
   * Otherwise, backpropagation is disabled to prevent wasted effort.
   *
   * @param rawInput The raw input to the neuron before applying ReLU6.
   * @param error The error from the output layer.
   * @returns A value from 0 (do not propagate) to 1 (fully propagate).
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    if (rawInput > 0 && rawInput < 6) {
      return 1;
    }

    if (rawInput <= 0 && error > 0) {
      return 1; // Try to reactivate
    }

    if (rawInput >= 6 && error < 0) {
      return 1; // Try to lower from saturated high
    }

    return 0;
  }
}
