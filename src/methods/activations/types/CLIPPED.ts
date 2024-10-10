import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
  public readonly range: ActivationRange = new ActivationRange(this, -1, 1);

  getName() {
    return CLIPPED.NAME;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return activation;
  }

  squash(x: number) {
    const v = Math.max(-1, Math.min(1, x));

    return v;
  }
}
