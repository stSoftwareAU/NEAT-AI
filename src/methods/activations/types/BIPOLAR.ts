import type { ActivationInterface } from "../ActivationInterface.ts";
import {
  type UnSquashInterface,
  validationActivation,
} from "../UnSquashInterface.ts";

/**
 * Bipolar Activation Function
 * Used in binary classification problems and outputs either -1 or 1.
 * The function is non-differentiable at zero.
 * Formula: f(x) = x > 0 ? 1 : -1
 */
export class BIPOLAR implements ActivationInterface, UnSquashInterface {
  public static NAME = "BIPOLAR";

  getName() {
    return BIPOLAR.NAME;
  }

  range() {
    return {
      low: -1,
      high: 1,
      normalize: (targetActivation: number): number => {
        return this.squash(targetActivation);
      },
    };
  }

  unSquash(activation: number, hint?: number): number {
    validationActivation(this, activation);

    if (Number.isFinite(hint)) return hint ? hint : 0;

    return activation;
  }

  squash(x: number) {
    return x > 0 ? 1 : -1;
  }
}
