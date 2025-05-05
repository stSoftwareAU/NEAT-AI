import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TANH (Hyperbolic Tangent) Activation Function
 *
 * f(x) = tanh(x)
 * f⁻¹(y) = 0.5 * log((1 + y) / (1 - y))
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Hyperbolic_functions#Hyperbolic_tangent
 */
export class TANH
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static readonly NAME = "TANH";

  public readonly range: ActivationRange = new ActivationRange(
    TANH.NAME,
    -1,
    1,
  );

  getName(): string {
    return TANH.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.tanh(${value})`;
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

    if (safeSlope !== 0) {
      return rawError * safeSlope;
    }

    // 🥽 Fallback to unSquash-based error
    const currentRaw = this.unSquash(currentActivation, hint);
    const targetRaw = this.unSquash(targetActivation, hint);
    const error = targetRaw - currentRaw;

    return Number.isFinite(error) ? error : 0;
  }
}
