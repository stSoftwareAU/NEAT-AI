import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
   * Calculates error for Cube activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = x³
   *   f′(x) = 3x²
   *   f⁻¹(y) = ∛y
   *
   * Strategy:
   *   ✅ Use derivative if slope is non-zero and finite.
   *   🥽 Fallback to foggy unSquash-based error if slope ≈ 0.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const slope = this.derivative(currentValue);

    if (Math.abs(slope) > 1e-8) {
      const safeSlope = Math.min(Math.max(slope, -50), 50);
      return (targetActivation - currentActivation) * safeSlope;
    }

    // 🥽 Fallback to foggy glasses
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;

    return Math.tanh(error);
  }
}
