import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The COMPLEMENT activation function computes the inverse of the input.
 * It returns 1 - x for any input x. Useful for particular kinds of
 * normalization or balancing tasks.
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

  getName() {
    return COMPLEMENT.NAME;
  }

  inlineSquash(value: string): string {
    return `1 - (${value})`;
  }

  squash(x: number) {
    const value = 1 - x;
    return COMPLEMENT.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return 1 - activation;
  }
}
