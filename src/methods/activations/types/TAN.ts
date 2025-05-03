import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TAN Activation Function
 *
 * f(x) = tan(x)
 * f⁻¹(y) = atan(y) + πk, where k ∈ ℤ
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Trigonometric_functions#Tangent
 */
export class TAN
  implements
    ActivationInterface,
    UnSquashInterface,
    InlineSquashInterface,
    SimplifyBiasInterface {
  public static readonly NAME = "TAN";

  public readonly range: ActivationRange = new ActivationRange(
    TAN.NAME,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return TAN.NAME;
  }

  simplifyBias(bias: number): number {
    return bias % Math.PI;
  }

  inlineSquash(value: string): string {
    return `Math.tan(${value})`;
  }

  squash(x: number): number {
    const result = Math.tan(x);
    return Number.isFinite(result) ? result : 0;
  }

  unSquash(activation: number, hint?: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be finite.");
    }

    const baseValue = Math.atan(activation);

    if (hint !== undefined && Number.isFinite(hint)) {
      const difference = hint - baseValue;
      const adjustment = Math.round(difference / Math.PI) * Math.PI;
      return baseValue + adjustment;
    }

    return baseValue;
  }

  /**
   * Computes the derivative of the tangent (TAN) activation function.
   *
   * The tangent function is defined as:
   *    f(x) = tan(x)
   *
   * The derivative is:
   *    f'(x) = 1 + tan²(x)
   *
   * This function is undefined at odd multiples of π/2 due to vertical asymptotes,
   * but we cap the result to prevent instability in gradient-based methods.
   * The output is guaranteed to be finite for all finite x.
   *
   * @param x - The input value.
   * @returns The capped derivative of tan(x).
   * @throws If x is not a finite number.
   *
   * References:
   * - https://en.wikipedia.org/wiki/Tangent_function
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    const tanX = Math.tan(x);
    const d = 1 + tanX * tanX;

    // Cap derivative to avoid exploding gradients (arbitrarily chosen bounds)
    if (!Number.isFinite(d) || d > 1000) return 1000;
    return d;
  }
}
