import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ReLU6 Activation Function
 *
 * ReLU6 is similar to the ReLU function but caps the output at 6. It is defined as
 * f(x) = min(max(0, x), 6). This capping helps in preventing the activations from
 * becoming too large.
 *
 * Reference:
 * https://www.tensorflow.org/api_docs/python/tf/nn/relu6
 */
export class ReLU6 implements ActivationInterface, UnSquashInterface {
  public static NAME = "ReLU6";

  public readonly range: ActivationRange = new ActivationRange(this, 0, 6);

  /** Since ReLU6 is not invertible above 6, the unSquash method uses hints similarly to ReLU. */
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0 && activation < 6) {
      return activation; // Activation is in the linear range of ReLU6
    }

    // If activation is 6, the input could have been any value >= 6, so we use the hint if provided
    if (activation === 6 && hint !== undefined) {
      return hint > 6 ? hint : 6;
    }

    // For activation of 0, it could have been any negative input or zero
    if (hint === undefined) {
      return 0;
    }

    return hint;
  }

  getName() {
    return ReLU6.NAME;
  }

  /** Implementation of the ReLU6 function */
  squash(x: number) {
    return Math.min(Math.max(0, x), 6);
  }
}
