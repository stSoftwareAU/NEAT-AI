import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/** Exponential Linear(ELU) */
export class ELU implements ActivationInterface, UnSquashInterface {
  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    if (activation > 0) {
      return activation;
    } else {
      const value = (activation / ELU.ALPHA) + 1 + Number.EPSILON;
      if (value <= 0) {
        return activation; // Return activation as the best guess if the argument to Math.log is not positive
      }
      return Math.log(value);
    }
  }

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  public static NAME = "ELU";

  private static ALPHA = 1.0; // You can choose a different value if desired

  getName() {
    return ELU.NAME;
  }

  squash(x: number) {
    return x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);
  }
}
