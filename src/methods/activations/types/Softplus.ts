import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softplus Activation Function
 *
 * f(x) = log(1 + exp(x))
 * f⁻¹(y) = log(exp(y) - 1)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#Softplus
 */
export class Softplus implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 4;
  public static readonly NAME = "Softplus";

  private static readonly LARGE_THRESHOLD = 100;
  private static readonly SMALL_THRESHOLD = 1e-15;

  public static readonly rangeStatic = new ActivationRange(
    Softplus.NAME,
    Softplus.SMALL_THRESHOLD,
    Softplus.LARGE_THRESHOLD,
  );

  public readonly range = Softplus.rangeStatic;

  getName(): string {
    return Softplus.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return Softplus.SMALL_THRESHOLD;

    if (x >= 709) {
      return Softplus.LARGE_THRESHOLD;
    }

    const value = Math.log(1 + Math.exp(x));
    return Softplus.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation < Softplus.SMALL_THRESHOLD) {
      return 0; // Treat as flat zone
    }

    const expA = Math.exp(activation);
    const diff = expA - 1;

    if (diff <= 0 || !Number.isFinite(diff)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
    }

    return Math.log(diff);
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    const d = 1 / (1 + Math.exp(-x)); // sigmoid(x)
    return Number.isFinite(d) ? d : 0;
  }

  /**
   * Calculates error for SOFTPLUS activation.
   *
   * Summary:
   *   f(x)   = ln(1 + e^x)
   *   f′(x)  = 1 / (1 + e^(-x)) = sigmoid(x)
   *   f⁻¹(y) = ln(e^y - 1), valid when y > 0
   *
   * Strategy:
   *   ✅ Use derivative when slope is safe
   *   🥽 Use unSquash when slope is near 0 (large negative x)
   *   🔒 Clamp result to prevent extreme weight updates
   *
   * Notes:
   *   - Derivative is sigmoid(x), smooth and always positive
   *   - Fallback to unSquash near log(1) region is safe with clamping
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
    if (slope > 1e-8) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * Returns a normalized score [0, 1] indicating how safe it is to
   * backpropagate through a Softplus-activated neuron.
   *
   * Softplus:
   *    f(x) = ln(1 + exp(x))
   *
   * Derivative:
   *    f'(x) = 1 / (1 + exp(−x)) = logistic(x)
   *
   * Behavior:
   *   - x ≫ 0 → behaves like ReLU(x), gradient ≈ 1 (safe)
   *   - x ≪ 0 → behaves like exp(x), gradient ≈ 0 (flat)
   *
   * This function:
   *   - Returns 1.0 for x ∈ [−5, 5] (ideal learning zone)
   *   - Returns 0.2 if the error would move x back toward center
   *   - Fades from 1.0 → 0.0 for x ∈ [−8, −5]
   *   - Ignores weight (currently unused)
   *
   * @param rawInput The pre-activation value x
   * @param error The output error
   * @param _weight The synapse weight (currently unused)
   * @returns A float in [0, 1] indicating propagation suitability
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    _weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const min = -8;
    const fadeStart = -5;
    const max = 5;

    // Fully safe learning zone
    if (rawInput >= fadeStart && rawInput <= max) return 1;

    // Recovery: x is negative, but error is positive (we want to increase output)
    if (rawInput < fadeStart && error > 0) return 0.2;

    // Fade out below -5
    if (rawInput >= min && rawInput < fadeStart) {
      return (rawInput - min) / (fadeStart - min); // fades from 0 to 1
    }

    return 0;
  }
}
