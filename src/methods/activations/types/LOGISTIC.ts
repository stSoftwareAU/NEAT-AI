import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class LOGISTIC implements ActivationInterface, UnSquashInterface {
  public static NAME = "LOGISTIC";
  public readonly range: ActivationRange = new ActivationRange(this, 0, 1);

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // To prevent log(0) and division by zero
    const safeActivation = Math.min(
      Math.max(activation, Number.EPSILON),
      1 - Number.EPSILON,
    );
    const value = Math.log(safeActivation / (1 - safeActivation));
    return value;
  }

  getName() {
    return LOGISTIC.NAME;
  }

  squash(x: number) {
    const fx = 1 / (1 + Math.exp(-x));
    return fx;
  }
}
