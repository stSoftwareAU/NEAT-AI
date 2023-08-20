import { ActivationInterface } from "../ActivationInterface.ts";

export class Softplus implements ActivationInterface {
  public static NAME = "Softplus";

  getName() {
    return Softplus.NAME;
  }

  squash(x: number) {
    return Math.log(1 + Math.exp(x));
  }

  squashAndDerive(x: number) {
    return {
      activation: this.squash(x),
      derivative: 1 / (1 + Math.exp(-x)),
    };
  }
}
