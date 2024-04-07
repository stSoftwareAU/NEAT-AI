import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

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
  /** Since ReLU6 is not invertible above 6, the unSquash method uses hints similarly to ReLU. */
  unSquash(activation: number, hint?: number): number {
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

  /** The output range of ReLU6 is between 0 and 6. */
  range(): { low: number; high: number } {
    return { low: 0, high: 6 };
  }

  public static NAME = "ReLU6";

  getName() {
    return ReLU6.NAME;
  }

  /** Implementation of the ReLU6 function */
  squash(x: number) {
    return Math.min(Math.max(0, x), 6);
  }
}
