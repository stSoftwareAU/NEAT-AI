import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";

/**
 * SQUARE Activation Function
 *
 * The SQUARE function returns the square of its input:
 *   f(x) = x²
 *
 * It is unbounded and always non-negative. This function is useful
 * in composite networks, such as when approximating L2 norms or building
 * higher-order relationships. It is not typically used as a final
 * activation function but rather as a structural component.
 *
 * Derivative:
 *   f'(x) = 2x
 *
 * Error Calculation:
 * Uses derivative 2x with either a given hint or the inferred
 * pre-squashed input (sqrt(currentActivation)).
 *
 * Behavior:
 * - Monotonic
 * - Even function
 * - Minimum at x = 0
 */
export class SQUARE implements ActivationInterface {
  public static NAME = "SQUARE";
  public mutationProbability = 1;

  /**
   * The output range is from 0 to +∞.
   */
  public readonly range = new ActivationRange(
    SQUARE.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return SQUARE.NAME;
  }

  /**
   * Returns the square of the input: x².
   *
   * @param x Input value
   * @returns Squared result
   */
  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return this.range.limit(x * x);
  }

  /**
   * Returns the derivative of x²: 2x.
   *
   * @param x Input value
   * @returns Derivative at x
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return 2 * x;
  }

  /**
   * UnSquash: returns ±√y with hint to preserve sign.
   */
  unSquash(activation: number, hint?: number): number {
    const sign = typeof hint === "number" && hint < 0 ? -1 : 1;
    return sign * Math.sqrt(Math.max(0, activation));
  }

  /**
   * Calculates error gradient based on target and current activation.
   *
   * @param currentActivation The current (squashed) activation value
   * @param targetActivation The desired activation value
   * @param hint Optional original input to squash(x)
   * @returns Error gradient to be used in backpropagation
   */
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
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  /**
  * Guides the backpropagation engine on how safe it is to push `rawInput`
  * further in its current direction — useful when choosing between adjusting
  * the input neuron or the synapse weight/bias.
  *
  * ### Behavior:
  * - Full confidence (`1`) in the range x ∈ [−5, 5]
  * - Linearly reduced confidence toward x ∈ ±10
  * - Very low confidence outside x ∈ ±10
  * - If error points **toward zero**, a small value (`0.2`) is returned even outside the range
  *
  * ### Rationale:
  * - The SQUARE function is x², with large gradients at high x.
  * - Large x values (e.g., ±100) cause instability and are hard to learn from.
  * - This helper encourages training to **stay within a tractable input range**.
  * - The weight can be adjusted instead to maintain output without huge inputs.
  *
  * ### Why include `error`?
  * - When the error moves us **back toward the center**, we allow a recovery push.
  *
  * ### Why include `weight`?
  * - Not directly used here, but included to support future extensions.
  */
  safeZoneAdjustment(
rawInput: number,
error: number,
weight: number,
): number {
if (!Number.isFinite(rawInput)) return 0;

const abs = Math.abs(rawInput);

// Safe zone: input ∈ [−5, 5]
if (abs <= 5) return 1;

// If error direction pushes input toward center, allow it (recovery zone)
if (rawInput > 5 && error < 0) return 0.2;
if (rawInput < -5 && error > 0) return 0.2;

// Fade between 5 and 10
if (abs <= 10) {
return 1 - (abs - 5) / 5;
}

// Beyond 10, input dominates and gradients explode
return 0;
}

}
