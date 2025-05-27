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
  public mutationProbability = 2;
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

  /**
   * Returns a normalized score [0, 1] indicating how suitable it is to
   * propagate an error signal through this neuron when using the Cube
   * activation function: f(x) = x³.
   *
   * The cube function grows extremely fast for large |x| values:
   *   - f(5) = 125
   *   - f(10) = 1000
   *   - f(100) = 1,000,000
   *
   * Its derivative is f'(x) = 3x², which means:
   *   - Derivative is small near x = 0 (but fine),
   *   - Derivative becomes **very large** as |x| increases.
   *
   * This makes backpropagation through neurons with large raw inputs
   * unstable or ineffective, especially when combined with weight scaling.
   *
   * This function helps prevent such instability by:
   *   - Returning 1.0 in the "safe zone" of x ∈ [−5, 5],
   *   - Gradually fading the score to 0.0 for x ∈ [−10, −5] ∪ [5, 10],
   *   - Returning 0.2 for "recovery conditions" where the error would move
   *     the neuron back toward the safe zone,
   *   - Returning 0.0 if raw input is far out of range and uncorrectable.
   *
   * The weight is currently unused, but included in the signature for
   * compatibility with squashes that scale sensitivity via connection weight.
   *
   * @param rawInput The raw pre-activation input of the neuron (x in f(x) = x³).
   * @param error The current neuron error (used to determine recovery direction).
   * @param _weight The connection weight — currently unused for Cube.
   * @returns A float in [0, 1] indicating whether it's useful to propagate here.
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    _weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const abs = Math.abs(rawInput);

    // Safe zone: x ∈ [−5, 5]
    if (abs <= 5) return 1;

    // Recovery: error moves us back in
    if (rawInput < -5 && error > 0) return 0.2;
    if (rawInput > 5 && error < 0) return 0.2;

    // Fade: x ∈ [5, 10]
    if (abs <= 10) {
      return 1 - (abs - 5) / 5;
    }

    return 0;
  }
}
