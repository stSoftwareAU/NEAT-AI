import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TANH (Hyperbolic Tangent) Activation Function
 *
 * f(x) = tanh(x)
 * f⁻¹(y) = 0.5 * log((1 + y) / (1 - y))
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Hyperbolic_functions#Hyperbolic_tangent
 */
export class TANH
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static readonly NAME = "TANH";

  public readonly range: ActivationRange = new ActivationRange(
    TANH.NAME,
    -1,
    1,
  );

  getName(): string {
    return TANH.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.tanh(${value})`;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.tanh(x);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (Math.abs(activation) >= 0.9999999) {
      // Prevent domain errors near ±1
      return typeof hint === "number" && Number.isFinite(hint)
        ? hint
        : Math.sign(activation) * 10;
    }

    const value = (1 + activation) / (1 - activation);

    if (value <= 1e-10 || !Number.isFinite(value)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
    }

    return 0.5 * Math.log(value);
  }
}
