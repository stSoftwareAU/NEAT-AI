import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
}
