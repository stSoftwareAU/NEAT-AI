import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bipolar Sigmoid Activation Function
 *
 * Common in neural networks where bipolar outputs [-1, 1] are desired.
 *
 * Formula: f(x) = 2 / (1 + exp(-x)) - 1
 * Inverse: f⁻¹(y) = -ln((2 / (y + 1)) - 1)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Bipolar_sigmoid
 */
export class BIPOLAR_SIGMOID implements ActivationInterface, UnSquashInterface {
  public static NAME = "BIPOLAR_SIGMOID";

  private static readonly rangeStatic = new ActivationRange(
    BIPOLAR_SIGMOID.NAME,
    -1,
    1,
  );

  public readonly range: ActivationRange = BIPOLAR_SIGMOID.rangeStatic;

  getName(): string {
    return BIPOLAR_SIGMOID.NAME;
  }

  squash(x: number): number {
    return 2 / (1 + Math.exp(-x)) - 1;
  }

  unSquash(activation: number, hint?: number): number {
    BIPOLAR_SIGMOID.rangeStatic.validate(activation, hint);

    const epsilon = 1e-10;
    // Ensure we never hit exact -1 or 1 due to rounding
    const y = Math.min(1 - epsilon, Math.max(-1 + epsilon, activation));

    const result = -Math.log((2 / (y + 1)) - 1);

    if (Number.isFinite(result)) {
      return result;
    }

    if (typeof hint === "number" && Number.isFinite(hint)) {
      return hint;
    }

    // Fallback to a large but finite number close to saturation
    return activation >= 0 ? 15 : -15;
  }

  /**
   * Derivative of BIPOLAR_SIGMOID:
   *
   * f(x) = (2 / (1 + exp(-x))) - 1
   * f′(x) = (1 - f(x)^2) / 2
   */
  derivative(x: number): number {
    const fx = this.squash(x);
    return (1 - fx * fx) / 2;
  }
  /**
   * Calculates error for BIPOLAR_SIGMOID activation with slope safeguards.
   *
   * Summary:
   *   f(x)   = (2 / (1 + e^(-x))) - 1
   *   f′(x)  = 0.5 × (1 - f(x)^2)
   *   f⁻¹(y) = -ln((2 / (y + 1)) - 1)
   *
   * Strategy:
   *   ✅ Prefer derivative (efficient and usually accurate)
   *   🥽 Fall back to unSquash if slope is too small or invalid
   *   🔒 Clamp extreme error values to prevent overflow
   *
   * Notes:
   *   - Derivative fades near ±1 → can cause large weight swings
   *   - unSquash is exact and cheap, safe fallback for edge cases
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);

    let error: number;
    if (Math.abs(slope) > 1e-8) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }
}
