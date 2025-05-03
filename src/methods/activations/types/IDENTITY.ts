import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * The IDENTITY activation function simply returns the input value.
 * It's mainly used in the output layer of regression problems.
 */
export class IDENTITY
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static NAME = "IDENTITY";

  public readonly range = new ActivationRange(
    IDENTITY.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return activation;
  }

  getName() {
    return IDENTITY.NAME;
  }

  inlineSquash(value: string): string {
    return value;
  }

  squash(x: number) {
    return this.range.limit(x);
  }
  /**
   * The derivative of the Identity function.
   *
   * The Identity function is defined as:
   *   f(x) = x
   * Therefore, its derivative is constant:
   *   f'(x) = 1
   *
   * This function is useful in neural networks when no transformation is needed,
   * often used for input or linear output neurons.
   *
   * @param x - The input value.
   * @returns 1 always.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }
    return 1;
  }
}
