import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Enhanced Step Activation Function
 *
 * Outputs 1 if the input exceeds a configurable threshold (default is 0) and 0 otherwise.
 * The derivative is undefined at the threshold and 0 everywhere else.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Step_function
 */
export class STEP implements ActivationInterface, UnSquashInterface {
  public static NAME = "STEP";
  private threshold: number;
  public readonly range: ActivationRange = new ActivationRange(
    this,
    0,
    1,
  );

  constructor(threshold: number = 0) {
    this.threshold = threshold;
  }

  getName() {
    return STEP.NAME;
  }

  /** Step function definition */
  squash(x: number) {
    return x > this.threshold ? 1 : 0;
  }

  /**
   * Function to estimate the input from the activation value.
   * Returns a typical expected value based on the activation and an optional hint.
   */
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // If activation is 0 or 1 and no hint is provided, return activation
    if (hint === undefined) {
      return activation;
    }

    /** Make sure the hint is the correct sign to be compatible with the activation */
    if (activation > this.threshold) {
      if (hint > this.threshold) {
        return hint;
      }
      return activation;
    } else {
      if (hint <= this.threshold) {
        return hint;
      }
      return activation;
    }
  }
}
