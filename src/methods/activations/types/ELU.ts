import { ActivationInterface } from "../ActivationInterface.ts";

export class ELU implements ActivationInterface {
  public static NAME = "ELU";

  private static ALPHA = 1.0; // You can choose a different value if desired

  getName() {
    return ELU.NAME;
  }

  squash(x: number) {
    return x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);
  }

  squashAndDerive(x: number) {
    return {
      activation: this.squash(x),
      derivative: x > 0 ? 1 : this.squash(x) + ELU.ALPHA,
    };
  }
}
