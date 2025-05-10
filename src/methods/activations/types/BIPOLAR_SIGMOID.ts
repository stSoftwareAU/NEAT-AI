import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bipolar Sigmoid Activation Function
 *
 * Common in neural networks where bipolar outputs [-1, 1] are desired.
 *
 * Formula: f(x) = 2 / (1 + exp(-x)) - 1
 * Inverse: f⁻¹(y) = -ln((2 / (y + 1)) - 1)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Bipolar_sigmoid
 */
export class BIPOLAR_SIGMOID implements ActivationInterface, UnSquashInterface {
  public static NAME = "BIPOLAR_SIGMOID";

  private static readonly rangeStatic = new ActivationRange(
    BIPOLAR_SIGMOID.NAME,
    -1,
    1,
  );

  public readonly range: ActivationRange = BIPOLAR_SIGMOID.rangeStatic;

  getName(): string {
    return BIPOLAR_SIGMOID.NAME;
  }

  squash(x: number): number {
    return 2 / (1 + Math.exp(-x)) - 1;
  }

  unSquash(activation: number, hint?: number): number {
    BIPOLAR_SIGMOID.rangeStatic.validate(activation, hint);

    const epsilon = 1e-10;
    // Ensure we never hit exact -1 or 1 due to rounding
    const y = Math.min(1 - epsilon, Math.max(-1 + epsilon, activation));

    const result = -Math.log((2 / (y + 1)) - 1);

    if (Number.isFinite(result)) {
      return result;
    }

    if (typeof hint === "number" && Number.isFinite(hint)) {
      return hint;
    }

    // Fallback to a large but finite number close to saturation
    return activation >= 0 ? 15 : -15;
  }

  /**
   * Derivative of BIPOLAR_SIGMOID:
   *
   * f(x) = (2 / (1 + exp(-x))) - 1
   * f′(x) = (1 - f(x)^2) / 2
   */
  derivative(x: number): number {
    const fx = this.squash(x);
    return (1 - fx * fx) / 2;
  }

  /**
   * Calculates error for BIPOLAR_SIGMOID using derivative or fallback.
   *
   * Summary:
   *   f(x) = (2 / (1 + e^(-x))) - 1
   *   f′(x) = (1 - f(x)^2) / 2
   *   f⁻¹(y) = -ln((2 / (y + 1)) - 1)
   *
   * Strategy:
   *   ✅ Derivative is always defined and smooth.
   *   🥽 Fallback used only if slope is near 0 or NaN.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    // Derivative using current activation (squash output)
    const slope = 0.5 * (1 - currentActivation ** 2);

    if (Number.isFinite(slope) && Math.abs(slope) > 1e-8) {
      const safeSlope = Math.min(Math.max(slope, -50), 50);
      const rawError = targetActivation - currentActivation;
      return rawError * safeSlope;
    }

    // Fallback using unSquash (i.e., calculate x for desired output)
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;

    return Math.tanh(error); // 🥽 Foggy-glasses fallback
  }
}
