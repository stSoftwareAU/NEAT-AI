import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Hard Tanh Activation Function
 * Piecewise linear function that clips input values to [-1, 1].
 * Formula: f(x) = max(-1, min(1, x))
 * Derivative: f'(x) = 1 if -1 < x < 1 else 0
 * Source: A Fast Learning Algorithm for Deep Belief Nets. Geoffrey Hinton et al., 2006
 * https://www.cs.toronto.edu/~fritz/absps/fastnc.pdf
 */
export class HARD_TANH
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static NAME = "HARD_TANH";
  public readonly range: ActivationRange = new ActivationRange(
    HARD_TANH.NAME,
    -1,
    1,
  );

  getName() {
    return HARD_TANH.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.max(-1, Math.min(1, ${value}))`;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.max(-1, Math.min(1, x));
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (
      typeof hint === "number" &&
      Number.isFinite(hint) &&
      this.squash(hint) === activation
    ) {
      return hint;
    }

    return activation;
  }

  /**
   * Derivative of the Hard Tanh function.
   * Returns 1 for -1 < x < 1, else 0.
   * @param x The input value.
   * @returns The derivative value.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    return x > -1 && x < 1 ? 1 : 0;
  }
}
