import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * COMPLEMENT Activation Function
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
export class COMPLEMENT
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
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

  inlineSquash(value: string): string {
    return `1 - (${value})`;
  }

  squash(x: number): number {
    return COMPLEMENT.rangeStatic.limit(1 - x);
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
   * Calculates error for COMPLEMENT activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = 1 - x
   *   f′(x) = -1
   *   f⁻¹(y) = 1 - y
   *
   * Strategy:
   *   ✅ Derivative is constant (-1), so always used.
   *   🥽 Fallback is technically possible but not needed.
   *
   * Notes:
   *   - Simple, linear, and invertible.
   *   - Error calculation is reliable, fast, and exact via derivative.
   *   - Rarely useful on its own, more useful when composed with other activations.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    _currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    return rawError * -1;
  }
}
