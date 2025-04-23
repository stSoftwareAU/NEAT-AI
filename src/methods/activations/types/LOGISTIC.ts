import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * LOGISTIC (Sigmoid) Activation Function
 *
 * f(x)   = 1 / (1 + exp(-x))
 * f⁻¹(y) = log(y / (1 - y))
 *
 * Range: (0, 1)
 * Reference:
 * https://en.wikipedia.org/wiki/Sigmoid_function
 */
export class LOGISTIC
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static readonly NAME = "LOGISTIC";

  public readonly range: ActivationRange = new ActivationRange(
    LOGISTIC.NAME,
    0,
    1,
  );

  getName(): string {
    return LOGISTIC.NAME;
  }

  inlineSquash(value: string): string {
    return `1 / (1 + Math.exp(-(${value})))`;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0.5; // avoid NaN/Inf
    const fx = 1 / (1 + Math.exp(-x));
    return this.range.limit(fx); // enforce (0, 1) safety
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const safeActivation = Math.min(
      Math.max(activation, Number.EPSILON),
      1 - Number.EPSILON,
    );

    return Math.log(safeActivation / (1 - safeActivation));
  }
}
