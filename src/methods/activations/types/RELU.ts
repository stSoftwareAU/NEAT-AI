import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ReLU (Rectified Linear Unit) Activation Function
 *
 * f(x) = max(0, x)
 * f⁻¹(y) = y (if y > 0), otherwise use hint or return 0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)
 */
export class RELU
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static readonly NAME = "RELU";

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    RELU.NAME,
    0,
    Number.MAX_VALUE,
  );

  public readonly range = RELU.rangeStatic;

  getName(): string {
    return RELU.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.max(0, (${value}))`;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const value = Math.max(0, x);
    return RELU.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    }

    return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
  }
}
