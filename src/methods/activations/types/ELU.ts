import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/** Exponential Linear(ELU) */
export class ELU implements ActivationInterface, UnSquashInterface {
  public static NAME = "ELU";

  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    } else {
      const value = (activation / ELU.ALPHA) + 1 + Number.EPSILON;
      if (value <= 0) {
        return activation; // Return activation as the best guess if the argument to Math.log is not positive
      }
      return Math.log(value);
    }
  }

  // range() {
  //   return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  // }

  private static ALPHA = 1.0; // You can choose a different value if desired

  getName() {
    return ELU.NAME;
  }

  squash(x: number) {
    const value = x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);

    return this.range.limit(value);
  }
}
