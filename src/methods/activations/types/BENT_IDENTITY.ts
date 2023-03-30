import { ActivationInterface } from "../ActivationInterface.ts";

export class BENT_IDENTITY implements ActivationInterface {
  public static NAME = "BENT_IDENTITY";

  getName() {
    return BENT_IDENTITY.NAME;
  }

  squash(x: number) {
    const d = Math.sqrt(Math.pow(x, 2) + 1);

    return (d - 1) / 2 + x;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);
    const d = Math.sqrt(Math.pow(x, 2) + 1);

    return {
      activation: fx,
      derivative: x / (2 * d) + 1,
    };
  }
}
