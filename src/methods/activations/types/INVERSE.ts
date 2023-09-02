import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

export class INVERSE implements ActivationInterface, UnSquashInterface {
  public static NAME = "INVERSE";

  getName() {
    return INVERSE.NAME;
  }

  squash(x: number) {
    return 1 - x;
  }

  unSquash(activation: number): number {
    return 1 - activation;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: -1,
    };
  }
}
