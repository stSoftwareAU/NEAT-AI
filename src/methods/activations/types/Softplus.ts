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
   * Determines whether it's appropriate to propagate error to upstream neurons,
   * or instead adjust the synaptic weight or bias.
   *
   * Softplus: f(x) = log(1 + exp(x))
   *   - Behaves like ReLU for large x
   *   - Smooths around 0, flattens for x << 0
   *
   * Logic:
   *   - Safe zone for raw input is [-10, 20].
   *   - If raw input is outside safe zone and error would worsen it, return 0.
   *   - If weight is out of safe bounds (too small or too large) and error would bring it back into range, return 0.
   *   - Otherwise return 1 (or fade between 0–1 near safe zone edges).
   *
   * @param rawInput - Raw input to the activation function.
   * @param error - Error signal.
   * @param weight - Incoming synapse weight.
   * @returns A number between 0–1 representing propagation safety.
   */
  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    if (!Number.isFinite(rawInput)) return 0;

    const safeMin = -10;
    const safeMax = 20;
    const inSafeRaw = rawInput >= safeMin && rawInput <= safeMax;

    const rawGettingWorse = (rawInput < safeMin && error < 0) ||
      (rawInput > safeMax && error > 0);

    const absWeight = Math.abs(weight);
    const minWeight = 1e-3;
    const maxWeight = 1e3;
    const weightTooSmall = absWeight < minWeight;
    const weightTooLarge = absWeight > maxWeight;
    const weightImproves = (weightTooSmall && weight * error > 0) ||
      (weightTooLarge && weight * error < 0);

    if (!inSafeRaw && rawGettingWorse) return 0;
    if (inSafeRaw && (weightTooSmall || weightTooLarge) && weightImproves) {
      return 0;
    }

    if (inSafeRaw) return 1;
    if (rawInput > safeMax && rawInput <= safeMax + 10) {
      return 1 - (rawInput - safeMax) / 10;
    }
    if (rawInput < safeMin && rawInput >= safeMin - 10) {
      return 1 - (safeMin - rawInput) / 10;
    }

    return 0;
  }
}
