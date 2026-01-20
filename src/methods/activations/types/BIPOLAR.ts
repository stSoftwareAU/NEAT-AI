import { assert } from "@std/assert";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";
class BipolarRange extends ActivationRange {
  constructor() {
    super("BIPOLAR", -1, 1);
  }

  override limit(value: number): number {
    assert(Number.isFinite(value));
    return value > 0 ? 1 : -1;
  }
}

/**
 * Bipolar Activation Function
 * Issue #1123: WASM Migration Phase 6 - Inline JS code generation removed.
 *
 * Used in binary classification problems and outputs either -1 or 1.
 * The function is non-differentiable at zero.
 * Formula: f(x) = x > 0 ? 1 : -1
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Binary_step_function
 */
export class BIPOLAR implements ActivationInterface, UnSquashInterface {
  public static NAME = "BIPOLAR";
  public mutationProbability = 1;
  public readonly range: ActivationRange = new BipolarRange();

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
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const targetValue = this.unSquash(targetActivation, currentValue);

    const error = targetValue - currentValue;
    return ErrorHelper.calculateClampedError(error);
  }
}
