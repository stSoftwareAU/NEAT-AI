import { ActivationError } from "@errors/ActivationError.ts";
import { ActivationRange } from "@propagate/ActivationRange.ts";
import { ErrorHelper } from "@propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "@methods/activations/AbstractActivationInterface.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { safeZoneAdjustment } from "@methods/activations/SafeZoneAdjustment.ts";
import type { UnSquashInterface } from "@methods/activations/UnSquashInterface.ts";

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

  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    return safeZoneAdjustment(rawInput, error, weight, -50, 50, 20);
  }
}
