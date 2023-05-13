import { ActivationInterface } from "../ActivationInterface.ts";

export class CLIPPED implements ActivationInterface {
  public static NAME = "CLIPPED";

  getName() {
    return CLIPPED.NAME;
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
