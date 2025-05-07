import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    // SELU derivative: scale if x ≥ 0; else scale * alpha * exp(x)
    return x >= 0 ? SELU.SCALE : SELU.SCALE * SELU.ALPHA * Math.exp(x);
  }

  /**
   * Calculates error for SELU (Scaled Exponential Linear Unit) using derivative or fallback.
   *
   * Summary:
   *   f(x) = λ * x                       if x ≥ 0
   *        = λ * α * (e^x - 1)          if x < 0
   *   f′(x) = λ                         if x ≥ 0
   *        = λ * (f(x)/x + α)           if x < 0
   *
   * Strategy:
   *   ✅ Uses derivative when slope is finite and reliable.
   *   🥽 Falls back to unSquash if derivative fails or activation is flat.
   *
   * Notes:
   *   - Combines linearity and exponential growth for self-normalizing networks.
   *   - Inversion for x < 0 is expensive but always possible.
   *   - Derivative is efficient and accurate in nearly all practical cases.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    const rawError = targetActivation - currentActivation;

    const x = this.unSquash(currentActivation, hint);
    const slope = this.derivative(x);

    const safeSlope = Number.isFinite(slope)
      ? Math.abs(slope) < 1e-8 ? 0 : Math.min(Math.max(slope, -50), 50)
      : Math.sign(slope);

    if (safeSlope !== 0) {
      return rawError * safeSlope;
    }

    // 🥽 Fallback to foggy glasses
    const rawCurrent = this.unSquash(currentActivation, hint);
    const rawTarget = this.unSquash(targetActivation, hint);
    const error = rawTarget - rawCurrent;

    return Number.isFinite(error) ? error : 0;
  }
}
