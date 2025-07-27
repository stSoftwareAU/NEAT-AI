import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The IDENTITY activation function simply returns the input value.
 * It's mainly used in the output layer of regression problems.
 */
export class IDENTITY
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public mutationProbability = 1;
  public static NAME = "IDENTITY";

  public readonly range = new ActivationRange(
    IDENTITY.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return activation;
  }

  getName() {
    return IDENTITY.NAME;
  }

  inlineSquash(value: string): string {
    return value;
  }

  squash(x: number) {
    return this.range.limit(x, x);
  }

  /**
   * The derivative of the Identity function.
   *
   * The Identity function is defined as:
   *   f(x) = x
   * Therefore, its derivative is constant:
   *   f'(x) = 1
   *
   * This function is useful in neural networks when no transformation is needed,
   * often used for input or linear output neurons.
   *
   * @param x - The input value.
   * @returns 1 always.
   */
  derivative(_x: number): number {
    return 1;
  }

  /**
   * Calculates error for IDENTITY activation.
   *
   * Summary:
   *   f(x) = x
   *   f′(x) = 1
   *   f⁻¹(y) = y
   *
   * Strategy:
   *   ✅ Always use raw error directly
   *   🔒 Clamp result to prevent overflow
   *
   * Notes:
   *   - Linear, invertible, and stable
   *   - No need for slope or fallback logic
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    _currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    return ErrorHelper.calculateClampedError(rawError);
  }

  /**
   * IDENTITY Safe Zone Adjustment Logic
   *
   * The identity function f(x) = x has a constant gradient and doesn't saturate.
   * However, extremely large raw values and extremely small weights may result in
   * numerically unstable or inefficient updates.
   *
   * Strategy:
   * - Prefer propagation unless raw input is extreme (>1e6) and weight is small (<1e-6)
   * - If raw input is extreme and weight is tiny, return 0 to nudge weight instead
   * - Otherwise, return full propagation signal
   *
   * @param rawInput Raw value before squashing (same as output)
   * @param _error Backpropagated error (ignored — always 1:1)
   * @param weight Synapse weight
   * @returns A number between 0 and 1
   */
  safeZoneAdjustment(rawInput: number, _error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const absRaw = Math.abs(rawInput);
    const absWeight = Math.abs(weight);

    const rawIsExtreme = absRaw > 1e6;
    const weightTooSmall = absWeight < 1e-6;

    if (rawIsExtreme && weightTooSmall) {
      return 0; // suggest adjusting the weight instead
    }

    return 1;
  }
}
