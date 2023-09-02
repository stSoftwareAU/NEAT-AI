import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

export class IDENTITY implements ActivationInterface, UnSquashInterface {
  unSquash(activation: number): number {
    return activation;
  }

  public static NAME = "IDENTITY";

  getName() {
    return IDENTITY.NAME;
  }

  squash(x: number) {
    return x;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: 1,
    };
  }
}
