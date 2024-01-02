import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/** Exponential Linear(ELU) */
export class ELU implements ActivationInterface, UnSquashInterface {
  unSquash(activation: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    if (activation > 0) {
      return activation;
    } else {
      return Math.log((activation / ELU.ALPHA) + 1 + Number.EPSILON);
    }
  }

  range(): { low: number; high: number } {
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

  squashAndDerive(x: number) {
    return {
      activation: this.squash(x),
      derivative: x > 0 ? 1 : this.squash(x) + ELU.ALPHA,
    };
  }
}
