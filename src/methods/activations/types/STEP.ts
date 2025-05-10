import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * STEP Activation Function
 *
 * f(x) = x > 0 ? 1 : 0
 * f⁻¹(y) ≈ any x > 0 for y=1, x ≤ 0 for y=0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Step_function
 */
export class STEP
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static readonly NAME = "STEP";

  public readonly range: ActivationRange = new ActivationRange(
    STEP.NAME,
    0,
    1,
  );

  getName(): string {
    return STEP.NAME;
  }

  inlineSquash(value: string): string {
    return `(${value}) > 0 ? 1 : 0`;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return x > 0 ? 1 : 0;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation === 1 && typeof hint === "number" && hint > 0) {
      return hint;
    }

    if (activation === 0 && typeof hint === "number" && hint <= 0) {
      return hint;
    }

    return activation;
  }

  /**
   * Computes the derivative of the STEP activation function.
   *
   * The derivative is defined as:
   * f'(x) = 0 for x ≠ 0
   * f'(x) = undefined for x = 0
   *
   * @param x The input value.
   * @returns The derivative value.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    // Use a small pseudo-gradient around the step threshold at x=0
    const epsilon = 0.01;
    return Math.abs(x) < epsilon ? 0.01 : 0;
  }

  /**
   * Calculates error for STEP activation using foggy (unSquash) fallback only.
   *
   * Summary:
   *   f(x) = 1 if x > 0
   *        = 0 if x ≤ 0
   *   f′(x) = 0 almost everywhere (undefined at x = 0)
   *
   * Strategy:
   *   🥽 Always uses foggy (unSquash) fallback.
   *
   * Notes:
   *   - Not differentiable; flat gradient makes learning impossible via derivatives.
   *   - Only reliable path is to estimate raw input difference via unSquash.
   *   - Typically avoided in gradient-based learning.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;
    return error;
  }
}
