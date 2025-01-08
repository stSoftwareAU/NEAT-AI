import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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

    if ((hint ? hint : 0) < 0) {
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
}
