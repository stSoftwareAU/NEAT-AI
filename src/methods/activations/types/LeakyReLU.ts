import { ActivationError } from "../../../errors/ActivationError.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class LeakyReLU implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 36;
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
      throw new ActivationError(
        `Non-finite input to ${this.getName()}.derivative: ${x}`,
        "NON_FINITE_INPUT",
        this.getName(),
        x,
      );
    }
    return x >= 0 ? 1 : LeakyReLU.ALPHA;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0; // <- guard for NaN or Infinity
    const value = x > 0 ? x : LeakyReLU.ALPHA * x;
    return LeakyReLU.rangeStatic.limit(value, x);
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
   * LeakyReLU Safe Zone Adjustment Logic
   *
   * LeakyReLU avoids a dead zone by preserving a small gradient for negative inputs.
   * This function determines whether the neuron should propagate error based on whether
   * the raw input is in a reasonable range and whether the connection weight is appropriate.
   *
   * Strategy:
   * - Always allows propagation in [−50, 50]
   * - Avoid propagating if rawInput is extremely large and getting worse
   * - If weight is far outside [1e-3, 1e3] and the update would bring it closer to that range,
   *   prefer adjusting the weight instead
   * - Uses a soft fade for borderline rawInput values
   *
   * @param rawInput Raw value before squashing
   * @param error Backpropagated error
   * @param weight Synapse weight
   * @returns A value [0, 1] indicating how strongly to allow error propagation
   */
  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;

    const safeMin = -50;
    const safeMax = 50;
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
    if (rawInput > safeMax && rawInput <= safeMax + 20) {
      return 1 - (rawInput - safeMax) / 20;
    }
    if (rawInput < safeMin && rawInput >= safeMin - 20) {
      return 1 - (safeMin - rawInput) / 20;
    }

    return 0;
  }
}
