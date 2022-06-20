import { ActivationInterface } from "../ActivationInterface.ts";

export class BIPOLAR implements ActivationInterface {
  public static NAME = "BIPOLAR";

  getName() {
    return BIPOLAR.NAME;
  }

  squash(x: number) {
    return x > 0 ? 1 : -1;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: 0,
    };
  }
}
