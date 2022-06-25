import { ActivationInterface } from "../ActivationInterface.ts";

export class LOGISTIC implements ActivationInterface {
  public static NAME = "LOGISTIC";

  getName() {
    return LOGISTIC.NAME;
  }

  squash(x: number) {
    const fx = 1 / (1 + Math.exp(-x));
    return fx;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: fx * (1 - fx),
    };
  }
}
