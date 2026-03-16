import { ActivationRange } from "@propagate/ActivationRange.ts";
import { ErrorHelper } from "@propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import { safeZoneAdjustment } from "../SafeZoneAdjustment.ts";
import { NR_MAX_ITERATIONS, NR_TOLERANCE } from "../NewtonRaphsonConstants.ts";
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
  private static readonly MAX_ITERATIONS = NR_MAX_ITERATIONS;
  private static readonly EPSILON = NR_TOLERANCE;

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
    // Numerical stability:
    // - For large positive x, exp(-x) underflows toward 0 (safe to treat as 0).
    // - For large negative x, exp(-x) overflows toward +∞, and x/(1+∞) -> 0.
    //
    // NOTE: A previous implementation incorrectly used `x < -20 ? 0 : exp(-x)`,
    // which made Swish behave ~like IDENTITY for large negative x. This breaks
    // WASM/JS parity and is mathematically incorrect.
    const expNegX = x > 20 ? 0 : Math.exp(-x);
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
   *   ✅ Use derivative when slope is healthy
   *   🥽 Fallback to unSquash when derivative vanishes (large negative x)
   *   🔒 Clamp result to prevent exploding updates
   *
   * Notes:
   *   - Swish derivative vanishes for large negative x
   *   - Fallback prevents exploding/zero error in saturation regions
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
    if (Math.abs(slope) > 1e-2) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }

  safeZoneAdjustment(rawInput: number, error: number, weight: number): number {
    return safeZoneAdjustment(rawInput, error, weight, -10, 10);
  }
}
