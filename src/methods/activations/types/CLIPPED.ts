import { assert } from "@std/assert/assert";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Clipped Activation Function
 * Forces all input values to fall within the range [-1, 1].
 * It is non-differentiable at x = -1 and x = 1.
 * Formula: f(x) = max(-1, min(1, x))
 */
export class CLIPPED implements ActivationInterface, UnSquashInterface {
  public static NAME = "CLIPPED";

  getName() {
    return CLIPPED.NAME;
  }

  range() {
    return { low: -1, high: 1 };
  }

  unSquash(activation: number): number {
    const range = this.range();
    assert(
      Number.isFinite(activation) &&
        activation >= range.low &&
        activation <= range.high,
    );

    return activation;
  }

  squash(x: number) {
    const v = Math.max(-1, Math.min(1, x));

    return v;
  }
}
