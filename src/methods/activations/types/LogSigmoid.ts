import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * LogSigmoid Activation Function
 *
 * f(x) = log(1 / (1 + exp(-x))) = -log(1 + exp(-x))
 * f⁻¹(y) = log(exp(y) / (1 - exp(y))) = y - log(1 - exp(y))
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Logistic_function
 */
export class LogSigmoid implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "LogSigmoid";

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    LogSigmoid.NAME,
    Number.MIN_SAFE_INTEGER,
    0,
  );

  public readonly range = LogSigmoid.rangeStatic;

  getName(): string {
    return LogSigmoid.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return LogSigmoid.rangeStatic.low;

    // Avoid overflow: when x << 0, exp(-x) = ∞
    if (x <= -709) {
      return LogSigmoid.rangeStatic.low;
    }

    const expNegX = Math.exp(-x);
    const value = -Math.log(1 + expNegX);

    return LogSigmoid.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    if (activation < -700) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : -10;
    }

    const expY = Math.exp(activation);
    const denom = 1 - expY;

    if (denom <= 0 || !Number.isFinite(expY)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : -10;
    }

    return Math.log(expY / denom);
  }

  /**
   * Computes the derivative of the LogSigmoid activation function.
   *
   * LogSigmoid is defined as:
   *   f(x) = log(sigmoid(x)) = -log(1 + exp(-x))
   *
   * Its derivative is:
   *   f'(x) = 1 - sigmoid(x)
   *
   * This reflects how sensitive the log-probability output is to small changes
   * in input — often used in probabilistic models and binary classification.
   *
   * @param x - The input value.
   * @returns The derivative at the input value.
   * @throws If input is not a finite number.
   *
   * References:
   * - https://en.wikipedia.org/wiki/Logistic_function
   * - https://paperswithcode.com/method/logsigmoid
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }
    // At very negative x, exp(-x) blows up; we avoid overflow by returning 0 early.
    if (x >= 709) return 0; // exp(x) would overflow
    if (x <= -745) return 1; // exp(x) underflows to 0

    const expNegX = Math.exp(-x);
    const denominator = 1 + expNegX;
    const value = expNegX / denominator;

    // Always clamp to safe float range
    return Math.max(Math.min(value, 1), 1e-6);
  }
}
