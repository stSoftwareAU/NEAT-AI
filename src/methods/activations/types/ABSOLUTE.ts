import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Absolute (ABSOLUTE) activation function.
 * Issue #1123: WASM Migration Phase 6 - Inline JS code generation removed.
 *
 * This activation function takes the absolute value of the input. The derivative is -1 for
 * negative input and 1 for positive input.
 *
 * Note: This function doesn't have a unique inverse, so the unSquash function will return
 * one possible original value (positive version of the input).
 */
export class ABSOLUTE implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 14;
  public static NAME = "ABSOLUTE";
  private static rangeStatic: ActivationRange = new ActivationRange(
    ABSOLUTE.NAME,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range: ActivationRange = ABSOLUTE.rangeStatic;

  unSquash(activation: number, hint?: number): number {
    ABSOLUTE.rangeStatic.validate(activation, hint);

    if (typeof hint === "number" && Number.isFinite(hint) && hint < 0) {
      return -activation;
    }

    return activation;
  }

  getName() {
    return ABSOLUTE.NAME;
  }

  squash(x: number) {
    return ABSOLUTE.rangeStatic.limit(Math.abs(x), x);
  }

  derivative(x: number): number {
    if (x > 0) return 1;
    if (x < 0) return -1;

    // At x=0 the derivative is undefined, we return 0 as a neutral approximation.
    return 0;
  }

  /**
   * Calculates the error for ABSOLUTE activation using foggy-glasses logic.
   *
   * Summary:
   *   f(x) = |x|
   *   f′(x) = -1 if x < 0; 1 if x > 0; undefined at x = 0
   *
   * Strategy:
   *   The ABSOLUTE function loses the sign of the input, so multiple input values
   *   can yield the same activation. To compute the error, we determine the two
   *   possible input values that would produce the target activation (`-target` and `+target`),
   *   and select the one closest to the current input (`currentValue`). The error is then
   *   the distance from `currentValue` to that nearest valid input.
   *
   *   This avoids relying on the undefined or discontinuous derivative at x = 0,
   *   and ensures meaningful training signals even near sharp corners.
   *
   * Example:
   *   currentValue = -2, targetActivation = 1 → nearest valid pre-image is -1 → error = +1
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const error = targetActivation - currentActivation;
    if (Math.abs(error) < ERROR_EPSILON) return 0;

    // Both -target and +target are valid inputs to ABSOLUTE
    const negTarget = -targetActivation;
    const posTarget = targetActivation;

    // Choose the target value (before squash) closest to currentValue
    const closestTarget =
      Math.abs(currentValue - negTarget) < Math.abs(currentValue - posTarget)
        ? negTarget
        : posTarget;

    return ErrorHelper.calculateClampedError(closestTarget - currentValue);
  }

  /**
   * Safe Zone Adjustment for ABSOLUTE activation
   *
   * The ABSOLUTE function loses sign information and has a sharp transition at 0.
   * This logic determines when to favour adjusting weights over raw input.
   *
   * Strategy:
   * - If raw input is very large (|rawInput| > 1000) and weight is tiny (|weight| < 1e-3), prefer weight adjustment
   * - Else: default to adjusting raw input
   *
   * @param rawInput Raw value before applying abs()
   * @param _error    Backpropagated error
   * @param weight   Associated synapse weight
   * @returns        Value in [0,1] indicating confidence in adjusting the raw input
   */
  safeZoneAdjustment(rawInput: number, _error: number, weight: number): number {
    const absInput = Math.abs(rawInput);
    const absWeight = Math.abs(weight);

    // const nearZeroInput = absInput < 1;
    const veryLargeInput = absInput > 1000;
    const tinyWeight = absWeight < 1e-3;

    // if (nearZeroInput) return 0; // raw input is ambiguous
    if (veryLargeInput && tinyWeight) return 0; // raw input extreme, but weight could move

    return 1;
  }
}
