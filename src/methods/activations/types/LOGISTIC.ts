import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * LOGISTIC (Sigmoid) Activation Function
 *
 * f(x)   = 1 / (1 + exp(-x))
 * f⁻¹(y) = log(y / (1 - y))
 *
 * Range: (0, 1)
 * Reference:
 * https://en.wikipedia.org/wiki/Sigmoid_function
 */
export class LOGISTIC implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 4;
  public static readonly NAME = "LOGISTIC";

  public readonly range: ActivationRange = new ActivationRange(
    LOGISTIC.NAME,
    0,
    1,
  );

  getName(): string {
    return LOGISTIC.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0.5; // avoid NaN/Inf
    const fx = 1 / (1 + Math.exp(-x));
    return this.range.limit(fx); // enforce (0, 1) safety
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const safeActivation = Math.min(
      Math.max(activation, Number.EPSILON),
      1 - Number.EPSILON,
    );

    return Math.log(safeActivation / (1 - safeActivation));
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    const y = this.squash(x);
    const d = y * (1 - y);
    return Number.isFinite(d) ? d : 0;
  }

  /**
   * Calculates error for LOGISTIC (sigmoid) activation.
   *
   * Summary:
   *   f(x)   = 1 / (1 + e^(-x))
   *   f′(x)  = f(x) * (1 - f(x))
   *   f⁻¹(y) = ln(y / (1 - y)), valid when 0 < y < 1
   *
   * Strategy:
   *   ✅ Use derivative when slope is strong (center region)
   *   🥽 Use unSquash in tails (slope near 0)
   *   🔒 Clamp to prevent exploding weights
   *
   * Notes:
   *   - Derivative fades in tails → unsafe to trust near y ≈ 0 or 1
   *   - Inversion is exact and cheap
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = currentActivation * (1 - currentActivation);

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
   * Determines how suitable it is to backpropagate through the LOGISTIC squash
   * based on the raw input value and error direction.
   *
   * The logistic activation function:
   *    squash(x) = 1 / (1 + exp(-x))
   *
   * It has its steepest gradient around x = 0 and flattens toward 0 or 1 as x → ±∞.
   * The safe gradient zone is approximately [-6, 6].
   *
   * This function returns a float in [0, 1] where:
   * - 1 means it's fully safe to backpropagate through this neuron.
   * - 0 means the gradient is too flat (i.e., near-saturation).
   * - Values in between indicate partial safety — used to scale error propagation.
   *
   * It also includes "recovery logic": if the raw input is outside the safe zone,
   * but the error would move it *toward* the safe zone, a small nonzero value is returned.
   * This allows neurons to recover from saturation through consistent error signals.
   *
   * @param rawInput The pre-squash value of the neuron.
   * @param config Global backpropagation config (plank constant, thresholds, etc.)
   * @param error The current output error (used to determine recovery direction).
   * @returns A number in [0, 1] indicating how suitable it is to adjust this neuron via activation.
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const safeLow = -6;
    const safeHigh = 6;
    const min = -10;
    const max = 10;

    // Fully safe zone
    if (rawInput >= safeLow && rawInput <= safeHigh) return 1;

    // Recovery logic: if we're out of zone, but error would push us back in
    if (rawInput < safeLow && error > 0) {
      return 0.2; // Pushes rawInput toward center
    }
    if (rawInput > safeHigh && error < 0) {
      return 0.2;
    }

    // Fading out logic: scale linearly from edge of safe zone to extreme
    if (rawInput > safeHigh && rawInput <= max) {
      return 1 - (rawInput - safeHigh) / (max - safeHigh); // fade from 1 to 0
    }
    if (rawInput < safeLow && rawInput >= min) {
      return (rawInput - min) / (safeLow - min); // fade from 0 to 1
    }

    // Beyond hard saturation
    return 0;
  }
}
