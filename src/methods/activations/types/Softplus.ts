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
   * Determines the suitability of propagating error through a neuron using
   * the Softplus activation function.
   *
   * Softplus(x) = ln(1 + exp(x))
   *
   * Characteristics:
   * - For x ≪ 0: squash ~ exp(x), gradient ≈ 0
   * - For x ≫ 0: squash ~ x, gradient ≈ 1
   *
   * This function:
   * 1. Returns 1.0 when x ∈ [−5, 5] (good learning region)
   * 2. Fades out linearly for x ∈ [−8, −5]
   * 3. Allows recovery (0.2) if the error would push x back into the learning zone
   * 4. Penalizes propagation when x is extremely large and weight is too small to be meaningful
   *
   * Constants:
   * - RAW_MAX = 1000
   * - WEIGHT_MIN = 1e-8
   *
   * @param rawInput The neuron's pre-squash input
   * @param error The error value driving propagation
   * @param weight The connection weight leading to this input
   * @returns A float in [0, 1] indicating the usefulness of activation-based propagation
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const min = -8;
    const fadeStart = -5;
    const safeHigh = 5;

    let score: number;

    if (rawInput >= fadeStart && rawInput <= safeHigh) {
      score = 1;
    } else if (rawInput < fadeStart && error > 0) {
      score = 0.2; // recovery from flat zone
    } else if (rawInput >= min && rawInput < fadeStart) {
      score = (rawInput - min) / (fadeStart - min); // fade from 0 → 1
    } else {
      score = 0;
    }

    const RAW_MAX = 1000;
    const WEIGHT_MIN = 1e-8;

    const weightPenalty = Math.min(1, Math.abs(weight) / WEIGHT_MIN);
    const rawPenalty = Math.min(1, RAW_MAX / Math.abs(rawInput));

    return score * weightPenalty * rawPenalty;
  }
}
