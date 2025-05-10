import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Absolute (ABSOLUTE) activation function.
 *
 * This activation function takes the absolute value of the input. The derivative is -1 for
 * negative input and 1 for positive input.
 *
 * Note: This function doesn't have a unique inverse, so the unSquash function will return
 * one possible original value (positive version of the input).
 */
export class ABSOLUTE
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static NAME = "ABSOLUTE";
  private static rangeStatic: ActivationRange = new ActivationRange(
    ABSOLUTE.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  inlineSquash(value: string): string {
    return `Math.abs(${value})`;
  }

  public readonly range: ActivationRange = ABSOLUTE.rangeStatic;

  unSquash(activation: number, hint?: number): number {
    ABSOLUTE.rangeStatic.validate(activation, hint);

    if (typeof hint === "number" && Number.isFinite(hint) && hint < 0) {
      return -activation;
    }

    return activation;
  }

  getName() {
    return ABSOLUTE.NAME;
  }

  squash(x: number) {
    return ABSOLUTE.rangeStatic.limit(Math.abs(x));
  }

  derivative(x: number): number {
    if (x > 0) return 1;
    if (x < 0) return -1;

    // At x=0 the derivative is undefined, we return 0 as a neutral approximation.
    return 0;
  }

  /**
   * Calculates error for ABSOLUTE activation using foggy-glasses only.
   *
   * Summary:
   *   f(x) = |x|
   *   f′(x) = -1 if x < 0; 1 if x > 0; undefined at x = 0
   *
   * Strategy:
   *   🥽 Always fallback to foggy-glasses unSquash-based error.
   *   Derivative is discontinuous and not reliable near x = 0.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    if (Math.abs(currentActivation - targetActivation) < ERROR_EPSILON) {
      return 0;
    }
    const targetValue = Math.sign(currentValue) * targetActivation;
    const error = targetValue - currentValue;

    return error;
  }
}
