import { ActivationInterface } from "../ActivationInterface.ts";

export class GAUSSIAN implements ActivationInterface {
  public static NAME = "GAUSSIAN";

  getName() {
    return GAUSSIAN.NAME;
  }

  squash(x: number) {
    return Math.exp(-Math.pow(x, 2));
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: -2 * x * fx,
    };
  }
}
