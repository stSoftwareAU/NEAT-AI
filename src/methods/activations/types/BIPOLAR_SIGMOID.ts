import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bipolar Sigmoid Activation Function
 * It is commonly used in cases where bipolar output is desired.
 * The function outputs values in the range [-1, 1].
 * Formula: f(x) = 2 / (1 + exp(-x)) - 1
 */
export class BIPOLAR_SIGMOID implements ActivationInterface, UnSquashInterface {
  public static NAME = "BIPOLAR_SIGMOID";

  getName() {
    return BIPOLAR_SIGMOID.NAME;
  }

  range(): { low: number; high: number } {
    return { low: -1, high: 1 };
  }

  unSquash(activation: number): number {
    return -Math.log((2 / (activation + 1)) - 1);
  }

  squash(x: number) {
    return 2 / (1 + Math.exp(-x)) - 1;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: 0.5 * (1 + fx) * (1 - fx),
    };
  }
}
