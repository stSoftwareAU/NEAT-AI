import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TANH (Hyperbolic Tangent) Activation Function
 * Issue #1123: WASM Migration Phase 6 - Inline JS code generation removed.
 *
 * f(x) = tanh(x)
 * f⁻¹(y) = 0.5 * log((1 + y) / (1 - y))
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Hyperbolic_functions#Hyperbolic_tangent
 */
export class TANH implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 30;
  public static readonly NAME = "TANH";

  public readonly range: ActivationRange = new ActivationRange(
    TANH.NAME,
    -1,
    1,
  );

  getName(): string {
    return TANH.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.tanh(x);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (Math.abs(activation) >= 0.9999999) {
      // Prevent domain errors near ±1
      return typeof hint === "number" && Number.isFinite(hint)
        ? hint
        : Math.sign(activation) * 10;
    }

    const value = (1 + activation) / (1 - activation);

    if (value <= 1e-10 || !Number.isFinite(value)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
    }

    return 0.5 * Math.log(value);
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    // Compute the output of the tanh function at input x.
    // Tanh squashes input into the range (-1, 1).
    const y = Math.tanh(x);

    // The derivative of tanh is:
    //    f'(x) = 1 - tanh(x)^2
    //
    // Why? Because tanh is smooth and differentiable, and this rule arises from calculus.
    //
    // Intuition:
    // - When x is near 0, tanh(x) ≈ x, and f'(x) ≈ 1 → gradient flows freely.
    // - When x is very large or very negative, tanh(x) saturates near ±1,
    //   so f'(x) ≈ 0 → very little gradient flows (helps prevent overshooting).
    //
    // This matches biological "dampening" — strong signals saturate and change less.

    const d = 1 - y * y;

    // Ensure the result is finite and safe to use in back propagation.
    return Number.isFinite(d) ? d : 0;
  }

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
   * Determines how suitable it is to backpropagate through the TANH squash
   * based on the raw input value and error direction.
   *
   * The tanh function:
   *    tanh(x) = (e^x - e^-x) / (e^x + e^-x)
   *
   * Its derivative is steepest at x = 0 and approaches 0 as x moves toward ±∞.
   * This function returns a float from 0 (not safe) to 1 (fully safe) indicating
   * how useful it is to backpropagate through this neuron via activation.
   *
   * Recovery logic is applied when the neuron is saturated but the error direction
   * suggests that a small backprop step could move it back into the useful range.
   *
   * @param rawInput The raw input to the tanh squash function.
   * @param _config Global backprop config (currently unused).
   * @param error The current error value for the neuron.
   * @returns A float in [0, 1] indicating backpropagation safety.
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const safeLow = -2;
    const safeHigh = 2;
    const min = -6;
    const max = 6;

    // Fully in safe zone
    if (rawInput >= safeLow && rawInput <= safeHigh) return 1;

    // Recovery direction logic
    if (rawInput < safeLow && error > 0) return 0.2;
    if (rawInput > safeHigh && error < 0) return 0.2;

    // Gradual fade to saturation
    if (rawInput > safeHigh && rawInput <= max) {
      return 1 - (rawInput - safeHigh) / (max - safeHigh);
    }

    if (rawInput < safeLow && rawInput >= min) {
      return (rawInput - min) / (safeLow - min);
    }

    return 0;
  }
}
