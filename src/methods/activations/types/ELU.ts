import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Exponential Linear Unit (ELU) Activation Function
 *
 * ELU is a smoother version of ReLU that allows negative values.
 * It outputs `x` when `x > 0` and `α * (exp(x) - 1)` when `x <= 0`.
 * The inverse (unSquash) uses the logarithmic function for negative values.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#ELU
 */
export class ELU implements ActivationInterface, UnSquashInterface {
  public static NAME = "ELU";

  // Typical α value is 1.0, but it can be adjusted if needed
  private static ALPHA = 1.0;

  public readonly range: ActivationRange = new ActivationRange(
    this,
    -ELU.ALPHA,
    Number.MAX_SAFE_INTEGER,
  );

  // Function to estimate the input from the activation value
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    } else {
      const value = activation / ELU.ALPHA + 1;
      if (value <= 0) {
        return activation; // Return activation as the best guess if the argument to Math.log is not positive
      }
      return Math.log(value);
    }
  }

  getName() {
    return ELU.NAME;
  }

  // ELU function definition
  squash(x: number) {
    const value = x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);

    return this.range.limit(value);
  }
}
