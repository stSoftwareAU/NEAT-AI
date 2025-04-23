import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
}
