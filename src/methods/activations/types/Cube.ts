import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Cube Nonlinearity Activation Function
 *
 * The Cube function raises the input to the power of three (x^3).
 * It is a simple polynomial activation function that can help capture more complex relationships in data.
 * The derivative is calculated as 3 * x^2.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Power_function
 */
export class Cube implements ActivationInterface, UnSquashInterface {
  public static NAME = "Cube";

  // Safe maximum input value to prevent overflow when cubing
  private static readonly MAX_INPUT = Math.cbrt(Number.MAX_SAFE_INTEGER);

  public readonly range: ActivationRange = new ActivationRange(
    Cube.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  // Function to estimate the input from the activation value (inverse of the cube function).
  unSquash(activation: number, _hint?: number): number {
    // The inverse of the cube function is the cube root
    return Math.cbrt(activation);
  }

  getName() {
    return Cube.NAME;
  }

  // Cube function definition
  squash(x: number) {
    // Clip the input to the safe maximum range to avoid overflow
    const clippedX = Math.max(-Cube.MAX_INPUT, Math.min(x, Cube.MAX_INPUT));
    return clippedX ** 3;
  }

  derivative(x: number): number {
    return 3 * x * x;
  }

  /**
   * Calculates error for CUBE activation using derivative with fallback.
   *
   * Summary:
   *   f(x)   = x³
   *   f′(x)  = 3x²
   *   f⁻¹(y) = ∛y
   *
   * Strategy:
   *   ✅ Use derivative when slope is significant (x ≠ 0)
   *   🥽 Fall back to unSquash when x ≈ 0 (slope ≈ 0)
   *   🔒 Clamp result to avoid weight spikes
   *
   * Notes:
   *   - Fully differentiable and invertible
   *   - Slope vanishes at x = 0, which would cause unstable bac propagation
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = currentActivation - targetActivation;
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
