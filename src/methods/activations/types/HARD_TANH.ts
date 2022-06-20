import { ActivationInterface } from "../ActivationInterface.ts";

export class HARD_TANH implements ActivationInterface {
  public static NAME = "HARD_TANH";

  getName() {
    return HARD_TANH.NAME;
  }

  squash(x: number) {
    return Math.max(-1, Math.min(1, x));
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: x > -1 && x < 1 ? 1 : 0,
    };
  }
}
