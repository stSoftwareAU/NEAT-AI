import { ActivationInterface } from "../ActivationInterface.ts";

export class Swish implements ActivationInterface {
  public static NAME = "Swish";

  getName() {
    return Swish.NAME;
  }

  squash(x: number) {
    return x / (1 + Math.exp(-x));
  }

  squashAndDerive(x: number) {
    const sigmoid_x = 1 / (1 + Math.exp(-x));
    return {
      activation: this.squash(x),
      derivative: sigmoid_x * (1 + x * (1 - sigmoid_x)),
    };
  }
}
