import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Mish Activation Function.
 *
 * f(x) = x * tanh(ln(1 + exp(x)))
 *
 * Reference:
 * https://arxiv.org/abs/1908.08681
 */
export class Mish implements ActivationInterface, UnSquashInterface {
  complexityPenalty?: number | undefined;
  public mutationProbability = 10;

  public static readonly NAME = "Mish";
  private static readonly MAX_ITERATIONS = 100;
  private static readonly TOLERANCE = 1e-4;
  private static readonly SAFE_LIMIT = Number.MAX_SAFE_INTEGER / 2;

  public static readonly rangeStatic = new ActivationRange(
    Mish.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  public readonly range = Mish.rangeStatic;

  getName(): string {
    return Mish.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const value = x * Math.tanh(Math.log(1 + Math.exp(x)));
    return Mish.rangeStatic.limit(value);
  }

  squashAndDerive(x: number) {
    const eX = Math.exp(x);
    const e2x = Math.exp(2 * x);
    const x2 = x * x;
    const x3 = x2 * x;

    const omega = 4 * e2x + 4 * eX * x + e2x * x2 + 2 * eX * x2 +
      2 * x3 + 4 * eX + 4 * x + 6;
    const delta = 2 + 2 * eX + e2x;
    const raw = eX * omega / (delta ** 2);
    const derivative = Number.isFinite(raw) ? Math.max(raw, 0) : 0;

    return {
      activation: this.squash(x),
      derivative: derivative,
    };
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    let guess = hint ?? (activation >= 0 ? activation : activation / 2);
    guess = Math.max(Math.min(guess, Mish.SAFE_LIMIT), -Mish.SAFE_LIMIT);

    for (let i = 0; i < Mish.MAX_ITERATIONS; i++) {
      const { activation: fx, derivative } = this.squashAndDerive(guess);
      const error = fx - activation;

      if (Math.abs(error) < Mish.TOLERANCE) break;

      const safeDerivative = Math.abs(derivative) > 1e-6
        ? derivative
        : Math.sign(derivative) * 1e-6;
      guess -= error / safeDerivative;

      if (!Number.isFinite(guess)) return 0;

      guess = Math.max(Math.min(guess, Mish.SAFE_LIMIT), -Mish.SAFE_LIMIT);
    }

    return Number.isFinite(guess) ? guess : 0;
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    const { derivative } = this.squashAndDerive(x);
    return derivative;
  }

  /**
   * Calculates error for Mish activation using derivative only.
   *
   * Summary:
   *   f(x) = x * tanh(ln(1 + e^x))  (i.e., x * tanh(softplus(x)))
   *
   * Strategy:
   *   ✅ Always use derivative — smooth and defined across ℝ
   *   ❌ No fallback — inverse is not defined
   *   🔒 Clamp result to prevent extreme values
   *
   * Notes:
   *   - Mish is non-monotonic near 0, but that does not affect derivative-based learning
   *   - Use caution in extreme tails to avoid exploding weights
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
}
