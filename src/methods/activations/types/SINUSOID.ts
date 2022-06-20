import { ActivationInterface } from "../ActivationInterface.ts";

export class SINUSOID implements ActivationInterface {
  public static NAME = "SINUSOID";

  getName() {
    return SINUSOID.NAME;
  }

  squash(x: number) {
    return Math.sin(x);
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: Math.cos(x),
    };
  }
}
