import { ActivationInterface } from "../ActivationInterface.ts";

export class ABSOLUTE implements ActivationInterface {
  public static NAME = "ABSOLUTE";

  getName() {
    return ABSOLUTE.NAME;
  }

  squash(x: number) {
    return Math.abs(x);
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: x < 0 ? -1 : 1,
    };
  }
}
