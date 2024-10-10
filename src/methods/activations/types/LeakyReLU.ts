import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class LeakyReLU implements ActivationInterface, UnSquashInterface {
  public static NAME = "LeakyReLU";

  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return activation > 0 ? activation : activation / LeakyReLU.ALPHA;
  }

  // range() {
  //   return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  // }

  private static ALPHA = 0.01; // You can choose a different value if desired

  getName() {
    return LeakyReLU.NAME;
  }

  squash(x: number) {
    const value = x > 0 ? x : LeakyReLU.ALPHA * x;
    return this.range.limit(value);
  }
}
