import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

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

  range() {
    return { low: -1, high: 1 };
  }

  unSquash(activation: number, hint?: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    const result = -Math.log((2 / (activation + 1)) - 1);

    if (Number.isFinite(result)) {
      return result;
    }
    if (Number.isFinite(hint)) {
      return hint ? hint : 0;
    }
    return activation; // Return activation if result is not a finite number
  }

  squash(x: number) {
    return 2 / (1 + Math.exp(-x)) - 1;
  }
}
