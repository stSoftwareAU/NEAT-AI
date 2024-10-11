import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bipolar Activation Function
 * Used in binary classification problems and outputs either -1 or 1.
 * The function is non-differentiable at zero.
 * Formula: f(x) = x > 0 ? 1 : -1
 */
export class BIPOLAR implements ActivationInterface, UnSquashInterface {
  public static NAME = "BIPOLAR";
  public readonly range: ActivationRange = new ActivationRange(
    this,
    -1,
    1,
  );

  getName() {
    return BIPOLAR.NAME;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (Number.isFinite(hint)) return hint ? hint : 0;

    return activation;
  }

  squash(x: number) {
    return x > 0 ? 1 : -1;
  }
}
