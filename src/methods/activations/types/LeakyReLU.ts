import { ActivationInterface } from "../ActivationInterface.ts";

export class LeakyReLU implements ActivationInterface {
  public static NAME = "LeakyReLU";

  private static ALPHA = 0.01; // You can choose a different value if desired

  getName() {
    return LeakyReLU.NAME;
  }

  squash(x: number) {
    return x > 0 ? x : LeakyReLU.ALPHA * x;
  }

  squashAndDerive(x: number) {
    return {
      activation: this.squash(x),
      derivative: x > 0 ? 1 : LeakyReLU.ALPHA,
    };
  }
}
