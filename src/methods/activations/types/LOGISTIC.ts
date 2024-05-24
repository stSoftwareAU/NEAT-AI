import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class LOGISTIC implements ActivationInterface, UnSquashInterface {
  range() {
    return { low: 0, high: 1 };
  }

  unSquash(activation: number): number {
    // To prevent log(0) and division by zero
    const safeActivation = Math.min(
      Math.max(activation, Number.EPSILON),
      1 - Number.EPSILON,
    );
    const value = Math.log(safeActivation / (1 - safeActivation));
    return value;
  }

  public static NAME = "LOGISTIC";

  getName() {
    return LOGISTIC.NAME;
  }

  squash(x: number) {
    const fx = 1 / (1 + Math.exp(-x));
    return fx;
  }
}
