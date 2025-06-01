import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Hard Tanh Activation Function
 * Piecewise linear function that clips input values to [-1, 1].
 * Formula: f(x) = max(-1, min(1, x))
 * Derivative: f'(x) = 1 if -1 < x < 1 else 0
 * Source: A Fast Learning Algorithm for Deep Belief Nets. Geoffrey Hinton et al., 2006
 * https://www.cs.toronto.edu/~fritz/absps/fastnc.pdf
 */
export class HARD_TANH
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public mutationProbability = 21;
  public static NAME = "HARD_TANH";
  public readonly range: ActivationRange = new ActivationRange(
    HARD_TANH.NAME,
    -1,
    1,
  );

  getName() {
    return HARD_TANH.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.max(-1, Math.min(1, ${value}))`;
  }

  squash(x: number): number {
    return Math.max(-1, Math.min(1, x));
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (
      typeof hint === "number" &&
      Number.isFinite(hint) &&
      this.squash(hint) === activation
    ) {
      return hint;
    }

    return activation;
  }

  /**
   * Derivative of the Hard Tanh function.
   * Returns 1 for -1 < x < 1, else 0.
   * @param x The input value.
   * @returns The derivative value.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    return x > -1 && x < 1 ? 1 : 0;
  }

  /**
   * Calculates error for HARD_TANH activation using piecewise logic.
   *
   * Summary:
   *   f(x) = -1           if x ≤ -1
   *        = x            if -1 < x < 1
   *        = +1           if x ≥ 1
   *
   *   f′(x) = 0           if |x| ≥ 1 (flat plateau)
   *        = 1            otherwise
   *
   * Strategy:
   *   ✅ Use derivative (1) when in center region
   *   🥽 Use direct error in flat regions where derivative = 0
   *   🔒 Clamp result to avoid runaway weights
   *
   * Notes:
   *   - Flat zones make back propagation unreliable — must fall back to direct signal
   *   - UnSquash not possible (not truly invertible)
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    if (Math.abs(targetActivation - currentActivation) < ERROR_EPSILON) {
      return 0;
    }

    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * Returns a score indicating how safe it is to back propagate through HARD_TANH.
   *
   * HARD_TANH behaves like a clipped linear function:
   *    f(x) = -1 for x ≤ -1
   *           x  for -1 < x < 1
   *           1  for x ≥ 1
   *
   * It is only differentiable in the linear zone (-1, 1). Outside that range,
   * backpropagation will have no effect unless the error pushes the raw input
   * back into the linear region.
   *
   * This function returns:
   * - 1.0 in the fully linear zone
   * - ~0.2 if recovery is possible
   * - 0 outside of useful range
   *
   * @param rawInput The raw input to the neuron before squash
   * @param error The current output error
   * @returns A float in [0, 1] representing propagation safety
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const safeLow = -0.9;
    const safeHigh = 0.9;
    const min = -1.2;
    const max = 1.2;

    // Fully safe region
    if (rawInput >= safeLow && rawInput <= safeHigh) return 1;

    // Recovery: out of bounds but error would bring it back
    if (rawInput <= -1 && error > 0) return 0.2;
    if (rawInput >= 1 && error < 0) return 0.2;

    // Fade into the dead zone
    if (rawInput > safeHigh && rawInput <= max) {
      return 1 - (rawInput - safeHigh) / (max - safeHigh);
    }

    if (rawInput < safeLow && rawInput >= min) {
      return (rawInput - min) / (safeLow - min);
    }

    return 0;
  }
}
