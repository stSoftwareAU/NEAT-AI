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
    if (typeof hint === "number" && Number.isFinite(hint)) {
      if (Math.sign(hint) === Math.sign(activation)) {
        return hint;
      }
      if (Math.abs(hint) < 1e-10 && activation < 0) {
        return hint;
      }
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
   * Derivative of BIPOLAR step function.
   *
   * f(x) = -1 if x < 0, +1 if x ≥ 0
   * f′(x) = 0 everywhere (non-differentiable step)
   */
  derivative(_x: number): number {
    return 0; // not differentiable anywhere
  }

  /**
   * Calculates error for BIPOLAR activation using foggy fallback.
   *
   * Summary:
   *   f(x) = -1 if x < 0, +1 otherwise
   *   f′(x) = 0 (undefined everywhere)
   *
   * Strategy:
   *   ❌ Derivative-based error not usable.
   *   🥽 Always fallback to foggy unSquash-based error.
   *
   * Notes:
   *   - Discrete jump: very limited in gradient-based learning.
   *   - Typically used in simple logic or binary classification.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    if (Math.abs(targetActivation - currentActivation) < 1e-10) {
      return 0;
    }

    const targetValue = this.unSquash(targetActivation, currentValue);

    const error = targetValue - currentValue;
    return error;
  }
}
