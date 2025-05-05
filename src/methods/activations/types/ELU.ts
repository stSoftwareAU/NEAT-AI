import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Exponential Linear Unit (ELU) Activation Function
 *
 * f(x) = x if x > 0
 *      = α * (exp(x) - 1) if x <= 0
 *
 * Inverse: x = log(y / α + 1) for y <= 0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#ELU
 */
export class ELU implements ActivationInterface, UnSquashInterface {
  public static NAME = "ELU";

  // Common α value
  private static readonly ALPHA = 1.0;

  public static readonly rangeStatic = new ActivationRange(
    ELU.NAME,
    -ELU.ALPHA,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = ELU.rangeStatic;

  getName(): string {
    return ELU.NAME;
  }

  squash(x: number): number {
    const value = x > 0 ? x : ELU.ALPHA * (Math.exp(x) - 1);
    return ELU.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    }

    // Ensure safe input to log()
    const ratio = activation / ELU.ALPHA + 1;

    if (ratio <= 0) {
      // Use hint if inverse would explode
      if (typeof hint === "number" && Number.isFinite(hint)) {
        return hint;
      }
      return -20; // conservative fallback
    }

    return Math.log(ratio);
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    // ELU derivative: 1 if x ≥ 0, else (f(x) + α)
    return x >= 0 ? 1 : this.squash(x) + ELU.ALPHA;
  }

  /**
   * Calculate the error for the ELU activation function.
   *
   * @param currentActivation The current activation value.
   * @param targetActivation The target activation value.
   * @param hint Optional hint for unSquash.
   * @returns The calculated error.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    const rawError = targetActivation - currentActivation;

    const x = this.unSquash(currentActivation, hint);
    const slope = this.derivative(x);

    const safeSlope = Number.isFinite(slope)
      ? Math.abs(slope) < 1e-8 ? 0 : Math.min(Math.max(slope, -50), 50)
      : Math.sign(slope);

    if (safeSlope !== 0) {
      return rawError * safeSlope;
    }

    // 🥽 Fallback to unSquash-based error
    const rawCurrent = this.unSquash(currentActivation, hint);
    const rawTarget = this.unSquash(targetActivation, hint);
    const error = rawTarget - rawCurrent;

    return Number.isFinite(error) ? error : 0;
  }
}
