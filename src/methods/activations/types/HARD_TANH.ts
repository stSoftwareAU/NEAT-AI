import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Hard Tanh Activation Function
 * Piecewise linear function that clips input values to [-1, 1].
 * Formula: f(x) = max(-1, min(1, x))
 * Derivative: f'(x) = 1 if -1 < x < 1 else 0
 * Source: A Fast Learning Algorithm for Deep Belief Nets. Geoffrey Hinton et al., 2006
 * https://www.cs.toronto.edu/~fritz/absps/fastnc.pdf
 */
export class HARD_TANH implements ActivationInterface, UnSquashInterface {
  public static NAME = "HARD_TANH";

  getName() {
    return HARD_TANH.NAME;
  }

  // Range of the activation function is [-1, 1]
  range(): { low: number; high: number } {
    return { low: -1, high: 1 };
  }

  // Implementing the unSquash function
  unSquash(activation: number): number {
    // Since the function is already bounded within [-1, 1], the unsquash is identity within the range
    return Math.max(-1, Math.min(1, activation));
  }

  squash(x: number) {
    return Math.max(-1, Math.min(1, x));
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: x > -1 && x < 1 ? 1 : 0,
    };
  }
}
