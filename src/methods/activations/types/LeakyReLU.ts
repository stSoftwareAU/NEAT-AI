import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class LeakyReLU implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 6;
  public static NAME = "LeakyReLU";

  public static readonly ALPHA = 0.01;

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    LeakyReLU.NAME,
    Number.MIN_SAFE_INTEGER * LeakyReLU.ALPHA,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = LeakyReLU.rangeStatic;

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    return activation > 0 ? activation : activation / LeakyReLU.ALPHA;
  }

  getName() {
    return LeakyReLU.NAME;
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    return x >= 0 ? 1 : LeakyReLU.ALPHA;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0; // <- guard for NaN or Infinity
    const value = x > 0 ? x : LeakyReLU.ALPHA * x;
    return LeakyReLU.rangeStatic.limit(value);
  }

  /**
   * Calculates error for LeakyReLU activation using derivative.
   *
   * Summary:
   *   f(x) = x       if x ≥ 0
   *        = α * x  if x < 0
   *   f′(x) = 1      if x ≥ 0
   *        = α      if x < 0
   *
   * Strategy:
   *   🎯 Always use unSquash as it's fast and accurate.
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

  /**
   * Returns a score [0, 1] indicating the suitability of backpropagation
   * through a neuron using LeakyReLU activation.
   *
   * LeakyReLU is a linear activation with a small slope on the negative side:
   *    f(x) = x         if x ≥ 0
   *         = a * x     if x < 0 (where a is small, e.g., 0.01)
   *
   * This makes it more resilient to dead neurons, but still has very low
   * sensitivity when x is extremely negative.
   *
   * This function:
   * - Returns 1.0 for x ∈ [−4, 4] (good gradient zone)
   * - Fades out from x ∈ [−10, −4]
   * - Allows recovery from deep negatives if error > 0
   * - Applies weight-based penalty if x ≫ 1000 and weight ≪ 1e-8
   *
   * @param rawInput The pre-activation input value
   * @param error The output error at this neuron
   * @param weight The connection weight to the input
   * @returns A float in [0, 1] representing backpropagation suitability
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const min = -10;
    const safeLow = -4;
    const safeHigh = 4;

    let score: number;

    if (rawInput >= safeLow && rawInput <= safeHigh) {
      score = 1;
    } else if (rawInput < safeLow && error > 0) {
      score = 0.2;
    } else if (rawInput >= min && rawInput < safeLow) {
      score = (rawInput - min) / (safeLow - min);
    } else {
      score = 0;
    }

    // Penalty if raw input is large but weight is tiny
    const RAW_MAX = 1000;
    const WEIGHT_MIN = 1e-8;

    const weightPenalty = Math.min(1, Math.abs(weight) / WEIGHT_MIN);
    const rawPenalty = Math.min(1, RAW_MAX / Math.abs(rawInput));

    return score * weightPenalty * rawPenalty;
  }
}
