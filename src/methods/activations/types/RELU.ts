import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ReLU (Rectified Linear Unit) Activation Function
 *
 * ReLU is defined as f(x) = max(0, x). It's widely used in neural networks for
 * hidden layers. The derivative is 1 for x > 0 and 0 for x <= 0.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)
 */
export class RELU implements ActivationInterface, UnSquashInterface {
  public readonly range: ActivationRange = new ActivationRange(
    this,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  // Function to estimate the input from the activation value
  // As ReLU is not an invertible function, this estimation returns the same
  // value for the input and assumes that the input was non-negative.
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // If activation is greater than 0, the inverse is the same as the activation
    if (activation > 0) {
      return activation;
    }

    // If activation is 0 and no hint is provided, return 0
    if (hint === undefined) {
      return 0;
    }

    // If activation is 0 and a hint is provided, return the hint
    return hint;
  }

  public static NAME = "RELU";

  getName() {
    return RELU.NAME;
  }

  // ReLU function definition
  squash(x: number) {
    const value = x > 0 ? x : 0;
    return this.range.limit(value);
  }
}
