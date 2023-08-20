import { ActivationInterface } from "../ActivationInterface.ts";

export class Mish implements ActivationInterface {
  public static NAME = "Mish";

  getName() {
    return Mish.NAME;
  }

  squash(x: number) {
    return x * Math.tanh(Math.log(1 + Math.exp(x)));
  }

  squashAndDerive(x: number) {
    const omega = 4 * (x + 1) + 4 * Math.exp(2 * x) + Math.exp(3 * x) +
      Math.exp(x) * (4 * x + 6);
    const delta = 2 * Math.exp(x) + Math.exp(2 * x) + 2;
    const derivative = Math.exp(x) * omega / (delta ** 2);

    return {
      activation: this.squash(x),
      derivative: derivative,
    };
  }
}
