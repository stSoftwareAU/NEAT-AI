import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Gaussian Activation Function
 *
 * f(x) = exp(-x²)
 * f⁻¹(y) = ±sqrt(-ln(y))
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Gaussian_function
 */
export class GAUSSIAN
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static NAME = "GAUSSIAN";

  public readonly range: ActivationRange = new ActivationRange(
    GAUSSIAN.NAME,
    0,
    1,
  );

  getName(): string {
    return GAUSSIAN.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.exp(-Math.pow(${value}, 2))`;
  }

  squash(x: number): number {
    // Avoid NaN: x² is always >= 0, so -x² is <= 0 → exp is safe
    const result = Math.exp(-x * x);

    // result is always in (0, 1] so it will pass limit()
    return this.range.limit(result);
  }

  unSquash(activation: number, hint?: number): number {
    // Already validated by this.range.validate(activation, hint)

    const sqrt = Math.sqrt(-Math.log(activation));
    // sqrt always ≥ 0, log is safe since activation ∈ (0, 1]

    return (hint ?? 0) < 0 ? -sqrt : sqrt;
  }
}
