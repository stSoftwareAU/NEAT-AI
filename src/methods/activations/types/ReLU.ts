import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ReLU (Rectified Linear Unit) Activation Function
 *
 * f(x) = max(0, x)
 * f⁻¹(y) = y (if y > 0), otherwise use hint or return 0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)
 */
export class ReLU implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 5;
  public static readonly NAME = "ReLU";

  public readonly range = new ActivationRange(
    ReLU.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return ReLU.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const value = Math.max(0, x);
    return this.range.limit(value, x);
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    return x > 0 ? 1 : 0;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    }

    return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
  }

  /**
   * Calculates error for ReLU (Rectified Linear Unit).
   *
   * Summary:
   *   f(x) = max(0, x)
   *   f′(x) = 1 if x > 0; otherwise 0
   *
   * Strategy:
   *   ✅ Use derivative when x > 0
   *   🥽 Use unSquash(targetActivation, currentValue) when x ≤ 0
   *   🔒 Clamp result to prevent large weight updates
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) {
      return 0;
    }

    const error = currentValue > 0
      ? rawError
      : this.unSquash(targetActivation, currentValue) - currentValue;

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * Indicates how safe or meaningful it is to propagate error through a ReLU neuron.
   *
   * ReLU (Rectified Linear Unit):
   *    f(x) = x when x > 0
   *         = 0 otherwise
   *
   * Only positive raw inputs allow error propagation. Neurons with x ≤ 0 are "dead"
   * unless the error is positive, in which case we attempt to reactivate them.
   *
   * A negative raw input with a negative error makes no sense for ReLU and likely
   * indicates an upstream squash mismatch or learning conflict.
   *
   * @param rawInput The raw (pre-squash) input value.
   * @param error The error value from the output layer.
   * @returns A value from 0 (useless) to 1 (safe to propagate).
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    if (rawInput > 0) {
      return 1; // Fully active
    }

    // Recovery: try to push back into positive zone
    if (rawInput <= 0 && error > 0) {
      return 1;
    }

    // Dead and shouldn't wake up
    return 0;
  }
}
