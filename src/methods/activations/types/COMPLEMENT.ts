import { assert } from "@std/assert/assert";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The COMPLEMENT activation function computes the inverse of the input.
 * It returns 1 - x for any input x. Useful for particular kinds of
 * normalization or balancing tasks.
 */
export class COMPLEMENT implements ActivationInterface, UnSquashInterface {
  public static NAME = "COMPLEMENT";

  getName() {
    return COMPLEMENT.NAME;
  }

  squash(x: number) {
    return 1 - x;
  }

  unSquash(activation: number): number {
    const range = this.range();
    assert(
      Number.isFinite(activation) &&
        activation >= range.low &&
        activation <= range.high,
    );

    return 1 - activation;
  }

  range() {
    return { low: -Infinity, high: Infinity };
  }
}
