import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softsign Activation Function
 *
 * f(x) = x / (1 + |x|)
 * f⁻¹(y) = y / (1 - |y|)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Comparison_of_activation_functions
 */
export class SOFTSIGN implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "SOFTSIGN";
  private static readonly LIMIT = 0.99;

  public readonly range: ActivationRange = new ActivationRange(
    SOFTSIGN.NAME,
    -SOFTSIGN.LIMIT,
    SOFTSIGN.LIMIT,
  );

  getName(): string {
    return SOFTSIGN.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;

    const d = 1 + Math.abs(x);
    const value = x / d;

    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const denom = 1 - Math.abs(activation);

    if (denom <= 1e-8 || !Number.isFinite(denom)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
    }

    return activation / denom;
  }

  /**
   * The derivative of the softsign function.
   *
   * @param x The input value.
   * @returns The derivative of the softsign function at the given input.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    const denom = 1 + Math.abs(x);
    return 1 / (denom * denom);
  }

  /**
   * Calculate the error based on the current and target activations.
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

    return rawError * safeSlope;
  }
}
