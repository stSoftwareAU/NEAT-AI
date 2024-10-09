import { assert } from "@std/assert/assert";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The IDENTITY activation function simply returns the input value.
 * It's mainly used in the output layer of regression problems.
 */
export class IDENTITY implements ActivationInterface, UnSquashInterface {
  unSquash(activation: number): number {
    const range = this.range();
    assert(
      Number.isFinite(activation) &&
        activation >= range.low &&
        activation <= range.high,
    );
    return activation;
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  public static NAME = "IDENTITY";

  getName() {
    return IDENTITY.NAME;
  }

  squash(x: number) {
    return x;
  }
}
