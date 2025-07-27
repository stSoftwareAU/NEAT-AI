import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Swish (SiLU) Activation Function
 *
 * f(x) = x * sigmoid(x) = x / (1 + exp(-x))
 *
 * Reference:
 * https://arxiv.org/abs/1710.05941
 */
export class Swish implements ActivationInterface, UnSquashInterface {
  public mutationProbability = 35;

  public static readonly NAME = "Swish";
  private static readonly MAX_ITERATIONS = 100;
  private static readonly EPSILON = 1e-6;

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    Swish.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = Swish.rangeStatic;

  getName(): string {
    return Swish.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const expNegX = x < -20 ? 0 : Math.exp(-x);
    const value = x / (1 + expNegX);
    return Swish.rangeStatic.limit(value, x);
  }

  /**
   * Attempts to compute the inverse of the Swish function using the Newton-Raphson method.
   * This is not commonly required for neural network applications, but can be useful
   * for analytical purposes or specific scenarios where the pre-activation value needs to be inferred.
   * @param activation The output value from the Swish function.
   * @param hint An optional initial guess for the Newton-Raphson method.
   * @returns The estimated input value that would produce the given activation output.
   */
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    let x = hint !== undefined
      ? hint
      : (activation >= 0 ? activation : activation / 2);

    for (let i = 0; i < Swish.MAX_ITERATIONS; i++) {
      const expNegX = x < -20 ? 0 : Math.exp(-x);
      const denom = 1 + expNegX;
      const sigmoidX = 1 / denom;
      const fx = x * sigmoidX - activation;

      if (Math.abs(fx) < Swish.EPSILON) {
        break;
      }

      const dSigmoid = expNegX / (denom * denom);
      const dfx = sigmoidX + x * -dSigmoid;

      const nextX = x -
        fx / (Math.abs(dfx) > 1e-8 ? dfx : Math.sign(dfx) * 1e-8);

      if (!Number.isFinite(nextX)) {
        return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
      }

      x = nextX;
    }

    return x;
  }

  derivative(x: number): number {
    const sigmoid = 1 / (1 + Math.exp(-x));
    const swishDerivative = sigmoid + x * sigmoid * (1 - sigmoid);

    return swishDerivative;
  }

  /**
   * Calculates error for Swish activation.
   *
   * Summary:
   *   f(x) = x * sigmoid(x) = x / (1 + e^(-x))
   *
   * Strategy:
   *   ✅ Always use derivative — smooth and non-zero
   *   ❌ No inverse; do not use unSquash
   *   🔒 Clamp result to prevent exploding updates
   *
   * Notes:
   *   - Swish has no dead zones
   *   - Suitable for deep networks with stable training
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
   * Swish Safe Zone Adjustment Logic
   *
   * Swish combines identity with sigmoid: f(x) = x * sigmoid(x).
   * It saturates for large |x|, flattening gradients.
   * This function encourages raw input adjustments only when gradients are strong.
   *
   * - Safe zone: x ∈ [−10, 10] — avoid flat sigmoid tails
   * - Avoid raw input adjustments that push further outside this range
   * - Consider weight adjustment fallback when weights are far outside [1e-3, 1e3]
   *   and moving in the correct direction
   *
   * @param rawInput Raw pre-activation value
   * @param error Error signal to propagate
   * @param weight Connection weight
   * @returns A number between 0 (avoid propagation) and 1 (safe to propagate)
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
