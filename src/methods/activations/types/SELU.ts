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
   * Returns a normalized score [0, 1] indicating how appropriate it is
   * to propagate error through a SELU-activated neuron.
   *
   * SELU is a scaled variant of ELU:
   *   SELU(x) = λ * x                          for x > 0
   *          = λ * α * (exp(x) - 1)           for x ≤ 0
   *
   * Its gradient is constant in the linear region and flattens in the
   * exponential region. SELU is designed to maintain normalization, but
   * can still saturate in the tails.
   *
   * This function:
   * - Returns 1.0 for x ∈ [−4, 4] (strong learning zone)
   * - Fades out linearly for x ∈ [−7, −4]
   * - Allows recovery from deep saturation if the error pushes x toward 0
   * - Penalizes propagation when rawInput is large and weight is too small
   *
   * Constants:
   * - RAW_MAX = 1000 (above this, prefer weight or bias adjustment)
   * - WEIGHT_MIN = 1e-8 (too small to support large raw values)
   *
   * @param rawInput The raw pre-activation value.
   * @param error The current error signal for this neuron.
   * @param weight The weight of the contributing synapse.
   * @returns A score in [0, 1] for suitability of activation-based propagation.
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const min = -7;
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

    // Soft fade if raw is very large and weight is small
    const RAW_MAX = 1000;
    const WEIGHT_MIN = 1e-8;

    const weightPenalty = Math.min(1, Math.abs(weight) / WEIGHT_MIN);
    const rawPenalty = Math.min(1, RAW_MAX / Math.abs(rawInput));

    return score * weightPenalty * rawPenalty;
  }
}
