import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Exponential Linear Unit (ELU) Activation Function
 *
 * f(x) = x if x > 0
 *      = α * (exp(x) - 1) if x <= 0
 *
 * Inverse: x = log(y / α + 1) for y <= 0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#ELU
 */
export class ELU implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 7;
  public static NAME = "ELU";

  // Common α value
  private static readonly ALPHA = 1.0;

  public readonly range = new ActivationRange(
    ELU.NAME,
    -ELU.ALPHA,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return ELU.NAME;
  }

  squash(x: number): number {
    const value = x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);
    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    }

    // Ensure safe input to log()
    const ratio = activation / ELU.ALPHA + 1;

    if (ratio <= 0) {
      // Use hint if inverse would explode
      if (typeof hint === "number" && Number.isFinite(hint)) {
        return hint;
      }
      return -20; // conservative fallback
    }

    return Math.log(ratio);
  }

  derivative(x: number): number {
    // ELU derivative: 1 if x ≥ 0, else (f(x) + α)
    return x >= 0 ? 1 : this.squash(x) + ELU.ALPHA;
  }

  /**
   * Calculates error for ELU (Exponential Linear Unit) using derivative only.
   *
   * Summary:
   *   f(x) = x              if x ≥ 0
   *        = α * (e^x - 1)  if x < 0
   *
   *   f′(x) = 1             if x ≥ 0
   *        = f(x) + α       if x < 0
   *
   * Strategy:
   *   ✅ Always use derivative — slope is always defined and non-zero
   *   ❌ No fallback required
   *   🔒 Clamp result to prevent extreme values
   *
   * Notes:
   *   - ELU is smooth and avoids dead zones like ReLU.
   *   - UnSquash is complex and unnecessary; derivative is fast and safe.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    const error = rawError / slope;

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * Returns a normalized score [0, 1] indicating how safe or appropriate
   * it is to propagate error through a neuron using the ELU activation.
   *
   * ELU is defined as:
   *   f(x) = x                      when x > 0
   *        = α * (exp(x) - 1)      when x ≤ 0
   *
   * Characteristics:
   * - For x > 0, ELU is linear and fully differentiable with f'(x) = 1.
   * - For x < 0, it behaves like an exponential curve approaching −α.
   * - Large x values can produce very large outputs, though the gradient remains constant.
   *
   * This function:
   * 1. Returns 1.0 in the "safe learning zone" (x ∈ [−4, 4]).
   * 2. Applies a soft fade between x ∈ [−7, −4] using a linear scale.
   * 3. Allows recovery (0.2) if the error would move x back into the safe zone.
   * 4. Multiplies the base score by a soft penalty factor based on:
   *    - How large the raw input is (discourages pushing already large values higher).
   *    - How small the weight is (discourages trying to push a large signal through a nearly-zero weight).
   *
   * This encourages the network to:
   * - Avoid wasting gradient effort in flat or unstable zones.
   * - Prefer adjusting weights or biases when the signal becomes extreme.
   *
   * Constants:
   * - RAW_MAX = 1000 (above this, we prefer weight/bias change)
   * - WEIGHT_MIN = 1e-8 (below this, weight is too small to support large raw input)
   *
   * @param rawInput The raw pre-activation input to the neuron.
   * @param error The error signal from the output.
   * @param weight The weight of the incoming synapse responsible for this input.
   * @returns A float in [0, 1] representing propagation suitability.
   */

  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const min = -7;
    const safeLow = -4;
    const safeHigh = 4;

    let score: number;

    // Fully safe learning zone
    if (rawInput >= safeLow && rawInput <= safeHigh) {
      score = 1;
    } else if (rawInput < safeLow && error > 0) {
      // Recovery case
      score = 0.2;
    } else if (rawInput >= min && rawInput < safeLow) {
      // Fade-in from -7 to -4
      score = (rawInput - min) / (safeLow - min);
    } else {
      score = 0;
    }

    // Soft fade if signal is too extreme
    const RAW_MAX = 1000;
    const WEIGHT_MIN = 1e-8;

    const weightPenalty = Math.min(1, Math.abs(weight) / WEIGHT_MIN);
    const rawPenalty = Math.min(1, RAW_MAX / Math.abs(rawInput));

    return score * weightPenalty * rawPenalty;
  }
}
