import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Scaled Exponential Linear Unit (SELU) activation function.
 *
 * This implementation uses constants ALPHA and SCALE, which are pre-defined values derived
 * from the paper "Self-Normalizing Neural Creatures" by Günter Klambauer, Thomas Unterthiner,
 * Andreas Mayr, and Sepp Hochreiter.
 *
 * - ALPHA = 1.6732632423543772848170429916717
 * - SCALE = 1.0507009873554804934193349852946
 *
 * These values are chosen to ensure self-normalizing properties for the activations, meaning
 * the outputs aim to have zero mean and unit variance across layers during the training process.
 *
 * For more details, see the paper: https://arxiv.org/pdf/1706.02515.pdf
 */
export class SELU implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 4;
  public static NAME = "SELU";

  private static ALPHA = 1.6732632423543772848170429916717;
  private static SCALE = 1.0507009873554804934193349852946;
  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    SELU.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range: ActivationRange = SELU.rangeStatic;

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const scaledActivation = activation / SELU.SCALE;

    if (scaledActivation > 0) {
      return scaledActivation;
    }

    if (scaledActivation > -SELU.ALPHA) {
      const ratio = scaledActivation / SELU.ALPHA + 1;
      if (ratio > 0) return Math.log(ratio);
    }

    if (typeof hint === "number" && Number.isFinite(hint)) {
      return hint;
    }

    return -10; // fallback default
  }

  getName() {
    return SELU.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return this.range.low;

    // Prevent overflow: beyond ~709, Math.exp(x) → ∞
    const safeX = Math.min(x, 709); // clamp upper bound only (no risk from large negative x)

    const fx = safeX > 0 ? safeX : SELU.ALPHA * Math.exp(safeX) - SELU.ALPHA;

    const scaled = fx * SELU.SCALE;
    return this.range.limit(scaled);
  }

  derivative(x: number): number {
    // SELU derivative: scale if x ≥ 0; else scale * alpha * exp(x)
    return x >= 0 ? SELU.SCALE : SELU.SCALE * SELU.ALPHA * Math.exp(x);
  }

  /**
   * Calculates error for SELU (Scaled Exponential Linear Unit).
   *
   * Summary:
   *   f(x) = λ * x                     if x ≥ 0
   *        = λ * α * (e^x − 1)        if x < 0
   *   f′(x) = λ                        if x ≥ 0
   *        = λ * α * e^x              if x < 0
   *
   * Strategy:
   *   ✅ Always use derivative — slope is always finite and non-zero
   *   ❌ No fallback required
   *   🔒 Clamp result to avoid extreme weight updates
   *
   * Notes:
   *   - Derivative is cheap and exact
   *   - No dead zones — suitable for stable back propagation
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);
    const error = rawError / slope;

    return ErrorHelper.calculateClampedError(error);
  }

  /**
   * SELU Safe Zone Adjustment Logic
   *
   * SELU combines exponential and linear components. Like ELU,
   * it can flatten or explode on extreme negative raw inputs.
   * This function determines whether it's safe to propagate error
   * through the neuron based on input and weight conditions.
   *
   * Strategy:
   * - Safe zone: x ∈ [−10, 10]
   * - Avoid worsening raw inputs outside that range
   * - Adjust weight if it's far from [1e-3, 1e3] and the update brings it closer
   * - Soft fade for near-borderline raw inputs
   *
   * @param rawInput Raw input before squashing
   * @param error Backpropagated error
   * @param weight Connection weight
   * @returns A number between 0 and 1 indicating adjustment strength
   */
  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;

    const safeMin = -10;
    const safeMax = 10;
    const inSafeRange = rawInput >= safeMin && rawInput <= safeMax;

    const rawGettingWorse = (rawInput < safeMin && error < 0) ||
      (rawInput > safeMax && error > 0);

    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;
    const weightImproving = (weightTooSmall && weight * error > 0) ||
      (weightTooLarge && weight * error < 0);

    if (!inSafeRange && rawGettingWorse) return 0;
    if (inSafeRange && (weightTooSmall || weightTooLarge) && weightImproving) {
      return 0;
    }

    if (inSafeRange) return 1;
    if (rawInput > safeMax && rawInput <= safeMax + 10) {
      return 1 - (rawInput - safeMax) / 10;
    }
    if (rawInput < safeMin && rawInput >= safeMin - 10) {
      return 1 - (safeMin - rawInput) / 10;
    }

    return 0;
  }
}
