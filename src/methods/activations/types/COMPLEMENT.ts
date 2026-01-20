import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * COMPLEMENT Activation Function
 * Issue #1123: WASM Migration Phase 6 - Inline JS code generation removed.
 *
 * f(x) = 1 - x
 * f⁻¹(y) = 1 - y
 *
 * Used in normalization or feature mirroring.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Feature_scaling
 * https://en.wikipedia.org/wiki/Complement_coding
 */
export class COMPLEMENT implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 1;
  public static NAME = "COMPLEMENT";

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    COMPLEMENT.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = COMPLEMENT.rangeStatic;

  getName(): string {
    return COMPLEMENT.NAME;
  }

  squash(x: number): number {
    return COMPLEMENT.rangeStatic.limit(1 - x, x);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);
    return 1 - activation;
  }

  /**
   * Computes the derivative of the Complement activation function.
   *
   * This function simply inverts the input linearly:
   *    f(x) = 1 - x
   *
   * Its derivative is constant:
   *    f'(x) = -1
   *
   * This function is trivially safe for all finite inputs.
   *
   * @param x - The input value.
   * @returns The derivative of the function, always -1.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }
    return -1;
  }

  /**
   * Calculates error for COMPLEMENT activation using derivative only.
   *
   * Summary:
   *   f(x)   = 1 - x
   *   f′(x)  = -1
   *   f⁻¹(y) = 1 - y
   *
   * Strategy:
   *   ✅ Always use derivative — constant, simple, fast
   *   ❌ No fallback or slope check needed
   *
   * Notes:
   *   - COMPLEMENT is linear and invertible.
   *   - Derivative is exactly -1, so error = actual - target.
   *   - Most useful when composed with conditional or composite activations.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    _currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    return ErrorHelper.calculateClampedError(rawError / -1);
  }
}
