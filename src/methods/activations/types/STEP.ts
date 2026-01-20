import { assert } from "@std/assert";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";
class StepRange extends ActivationRange {
  constructor() {
    super(STEP.NAME, 0, 1);
  }

  override limit(value: number): number {
    assert(Number.isFinite(value));
    return value > 0 ? 1 : 0;
  }
}

/**
 * STEP Activation Function
 * Issue #1123: WASM Migration Phase 6 - Inline JS code generation removed.
 *
 * f(x) = x > 0 ? 1 : 0
 * f⁻¹(y) ≈ any x > 0 for y=1, x ≤ 0 for y=0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Step_function
 */
export class STEP implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 2;
  public static readonly NAME = "STEP";

  public readonly range: ActivationRange = new StepRange();

  getName(): string {
    return STEP.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return x > 0 ? 1 : 0;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation === 1 && typeof hint === "number" && hint > 0) {
      return hint;
    }

    if (activation === 0 && typeof hint === "number" && hint <= 0) {
      return hint;
    }

    return activation;
  }

  /**
   * Computes the derivative of the STEP activation function.
   *
   * The derivative is defined as:
   * f'(x) = 0 for x ≠ 0
   * f'(x) = undefined for x = 0
   *
   * @param x The input value.
   * @returns The derivative value.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }

    // Use a small pseudo-gradient around the step threshold at x=0
    const epsilon = 0.01;
    return Math.abs(x) < epsilon ? 0.01 : 0;
  }

  /**
   * Calculates error for STEP activation using directional guess.
   *
   * Summary:
   *   f(x) = 1 if x > 0
   *        = 0 if x ≤ 0
   *   f′(x) = 0 almost everywhere (undefined at x = 0)
   *
   * Strategy:
   *   🧠 Always uses directional fallback — pushes input toward correct side of step.
   *   ❌ Derivative not usable (flat or undefined).
   *   ❌ Not truly invertible — fallback uses a hint-based guess, not a real unSquash.
   *
   * Notes:
   *   - Step breaks gradient flow; unsuitable for backpropagation.
   *   - We estimate the input movement direction from the activation mismatch.
   *   - `unSquash()` here serves only to bias the guess based on currentValue.
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
   * Safe zone estimator for the `STEP` activation function, which is discontinuous:
   *
   *   f(x) = 1 if x > 0
   *        = 0 otherwise
   *
   * This function helps determine whether it's safe or beneficial to adjust
   * the `rawInput` directly during backpropagation.
   *
   * ### Behavior:
   * - Returns `1` if the raw input is on the **wrong side** of the step and the error is pushing it **toward the threshold (x=0)**
   * - Returns `0.2` if input is already on the **correct side**, and small error remains
   * - Returns `0` for invalid or no-op adjustments
   *
   * ### Rationale:
   * - STEP has no derivative (gradient is zero or undefined)
   * - Only meaningful direction is crossing the threshold (x = 0)
   * - We want to adjust input only if that adjustment **could cause a class flip**
   * - Otherwise, prefer adjusting weights/biases upstream
   *
   * ### Notes:
   * - `weight` is included for API consistency, but unused
   * - This is a hard discontinuous function, so use with caution in gradient-based learning
   */

  safeZoneAdjustment(
    rawInput: number,
    error: number,
    _weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    // STEP function: threshold at x = 0
    const isAbove = rawInput > 0;
    const expectedAbove = error > 0;

    // If we're on the wrong side and the error pushes us toward the correct side
    if (isAbove !== expectedAbove) return 1;

    // If we're on the correct side, but error is still non-zero, reduce confidence
    return 0.2;
  }
}
