import type { ActivationInterface } from "../ActivationInterface.ts";
import {
  type UnSquashInterface,
  validationActivation,
} from "../UnSquashInterface.ts";

export class LeakyReLU implements ActivationInterface, UnSquashInterface {
  unSquash(activation: number): number {
    validationActivation(this, activation);

    return activation > 0 ? activation : activation / LeakyReLU.ALPHA;
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }
  public static NAME = "LeakyReLU";

  private static ALPHA = 0.01; // You can choose a different value if desired

  getName() {
    return LeakyReLU.NAME;
  }

  squash(x: number) {
    return x > 0 ? x : LeakyReLU.ALPHA * x;
  }
}
