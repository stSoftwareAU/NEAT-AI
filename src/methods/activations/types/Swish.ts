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
  public mutationProbability = 9;

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
    return Swish.rangeStatic.limit(value);
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
   * Indicates the usefulness of backpropagation through a neuron
   * using the Swish activation function.
   *
   * Swish(x) = x * sigmoid(x)
   *          = x / (1 + exp(-x))
   *
   * Characteristics:
   * - Smooth, non-monotonic near x = 0
   * - Behaves like ReLU for x ≫ 0, and x * exp(x) for x ≪ 0
   * - Gradient saturates slowly outside x ∈ [−5, 5]
   *
   * This function:
   * 1. Returns 1.0 for x ∈ [−3, 3] (ideal learning zone)
   * 2. Linearly fades for x ∈ [−6, −3] and [3, 6]
   * 3. Allows recovery if the error moves x toward center
   * 4. Penalizes high-magnitude rawInput when weight is too small to support propagation
   *
   * Constants:
   * - RAW_MAX = 1000
   * - WEIGHT_MIN = 1e-8
   *
   * @param rawInput The pre-activation value to the Swish squash
   * @param error The error signal for this neuron
   * @param weight The synapse weight feeding into this neuron
   * @returns A float in [0, 1] indicating propagation suitability
   */
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number {
    if (!Number.isFinite(rawInput)) return 0;

    const safeLow = -3;
    const safeHigh = 3;
    const min = -6;
    const max = 6;

    let score: number;

    if (rawInput >= safeLow && rawInput <= safeHigh) {
      score = 1;
    } else if (rawInput < safeLow && error > 0) {
      score = 0.2;
    } else if (rawInput > safeHigh && error < 0) {
      score = 0.2;
    } else if (rawInput > safeHigh && rawInput <= max) {
      score = 1 - (rawInput - safeHigh) / (max - safeHigh);
    } else if (rawInput < safeLow && rawInput >= min) {
      score = (rawInput - min) / (safeLow - min);
    } else {
      score = 0;
    }

    const RAW_MAX = 1000;
    const WEIGHT_MIN = 1e-8;

    const weightPenalty = Math.min(1, Math.abs(weight) / WEIGHT_MIN);
    const rawPenalty = Math.min(1, RAW_MAX / Math.abs(rawInput));

    return score * weightPenalty * rawPenalty;
  }
}
