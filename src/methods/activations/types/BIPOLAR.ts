import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bipolar Activation Function
 * Used in binary classification problems and outputs either -1 or 1.
 * The function is non-differentiable at zero.
 * Formula: f(x) = x > 0 ? 1 : -1
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Binary_step_function
 */
export class BIPOLAR
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static NAME = "BIPOLAR";
  public readonly range: ActivationRange = new ActivationRange(
    BIPOLAR.NAME,
    -1,
    1,
  );

  getName() {
    return BIPOLAR.NAME;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (typeof hint === "number" && Number.isFinite(hint)) {
      return hint;
    }

    // Use safe fallback: any positive number maps to 1, negative to -1
    return activation >= 0 ? 1 : -1;
  }

  /**
   * The inlineSquash function is used for optimization purposes.
   * It provides a string representation of the activation function
   * that can be used in optimized code generation.
   */
  inlineSquash(value: string): string {
    return `(${value}) > 0 ? 1 : -1`;
  }

  squash(x: number) {
    return x > 0 ? 1 : -1;
  }

  /**
   * Returns a small slope in the correct direction for use in gradient-based methods.
   * Not mathematically correct, but serves training stability.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    if (x > 0) return 1e-2;
    if (x < 0) return -1e-2;
    return 0;
  }
}
