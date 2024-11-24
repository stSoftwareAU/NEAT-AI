import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Inverse Square Root Unit (ISRU) Activation Function
 *
 * The ISRU function is defined as: f(x) = x / sqrt(1 + α * x^2).
 * It helps control the magnitude of activations and is useful for preventing exploding gradients.
 *
 * The derivative is: f'(x) = 1 / (sqrt(1 + α * x^2))^3.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Inverse_Square_Root_Unit_(ISRU)
 */
export class ISRU implements ActivationInterface, UnSquashInterface {
  public static NAME = "ISRU";
  private static ALPHA = 1.0; // Default value for α; can be adjusted as needed

  // The output range of ISRU is between -1/sqrt(α) and 1/sqrt(α)
  public readonly range: ActivationRange = new ActivationRange(
    this,
    -1 / Math.sqrt(ISRU.ALPHA),
    1 / Math.sqrt(ISRU.ALPHA),
  );

  // Function to estimate the input from the activation value (inverse of ISRU)
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // Ensure that the input is within the valid range
    const maxActivation = 1 / Math.sqrt(ISRU.ALPHA);
    if (Math.abs(activation) >= maxActivation) {
      return activation > 0
        ? Number.MAX_SAFE_INTEGER
        : -Number.MAX_SAFE_INTEGER;
    }

    // Calculate the inverse of ISRU
    const value = activation / Math.sqrt(1 - ISRU.ALPHA * activation ** 2);
    return value;
  }

  getName() {
    return ISRU.NAME;
  }

  // ISRU function definition
  squash(x: number) {
    return x / Math.sqrt(1 + ISRU.ALPHA * x ** 2);
  }
}
