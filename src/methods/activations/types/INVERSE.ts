import { ActivationInterface } from "../ActivationInterface.ts";

export class INVERSE implements ActivationInterface {
  public static NAME = "INVERSE";

  getName() {
    return INVERSE.NAME;
  }

  squash(x: number) {
    return 1 - x;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: -1,
    };
  }
}
