import { ActivationInterface } from "../ActivationInterface.ts";

export class BIPOLAR_SIGMOID implements ActivationInterface {
  public static NAME = "BIPOLAR_SIGMOID";

  getName() {
    return BIPOLAR_SIGMOID.NAME;
  }

  squash(x: number) {
    return 2 / (1 + Math.exp(-x)) - 1;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: 1 / 2 * (1 + fx) * (1 - fx),
    };
  }
}
