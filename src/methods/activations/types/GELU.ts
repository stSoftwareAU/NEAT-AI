import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Gaussian Error Linear Unit (GELU) Activation Function
 *
 * GELU is approximated as:
 *   f(x) = 0.5 * x * (1 + tanh(√(2/π) * (x + 0.044715 * x³)))
 *
 * GELU is smooth and differentiable, commonly used in Transformer models.
 * Reference:
 * https://arxiv.org/abs/1606.08415
 */
export class GELU implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "GELU";
  private static readonly CUBIC_COEF = 0.044715;
  private static readonly MAX_ITERATIONS = 100;
  private static readonly TOLERANCE = 1e-6;
  private static readonly MAX_X = 10;

  public readonly range = new ActivationRange(
    GELU.NAME,
    -0.17,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return GELU.NAME;
  }

  squash(x: number): number {
    // For very large negative values, return a very small negative number
    if (x < -GELU.MAX_X) return -0;

    // For very large positive values, return the input
    if (x > GELU.MAX_X) return this.range.limit(x);

    // Standard GELU approximation
    const value = 0.5 * x *
      (1 +
        Math.tanh(
          Math.sqrt(2 / Math.PI) * (x + GELU.CUBIC_COEF * Math.pow(x, 3)),
        ));

    return this.range.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (Math.abs(activation) < 1e-10) {
      return hint ?? -10;
    }

    let x = hint ?? (activation < 0.5 ? -1 : 1);

    for (let i = 0; i < GELU.MAX_ITERATIONS; i++) {
      const fx = this.squash(x) - activation;

      if (Math.abs(fx) < GELU.TOLERANCE) {
        break;
      }

      const derivative = this.derivative(x);
      if (Math.abs(derivative) < 1e-10) {
        if (Math.abs(fx) < 0.1) return x;
        break;
      }

      const nextX = x - fx / derivative;
      if (!Number.isFinite(nextX) || Math.abs(nextX) > GELU.MAX_X) {
        x = hint ?? 0;
        break;
      }

      x = nextX;
    }

    return x;
  }

  derivative(x: number): number {
    const x2 = x * x;
    const x3 = x2 * x;
    const term = x + GELU.CUBIC_COEF * x3;
    const sqrt2OverPi = Math.sqrt(2 / Math.PI);
    const b = sqrt2OverPi * term;

    const expB = Math.exp(b);
    const expNegB = 1 / expB;
    const tanhB = (expB - expNegB) / (expB + expNegB);
    const sech2 = 1 - tanhB * tanhB;

    return 0.5 * (
      (1 + tanhB) +
      x * sech2 * sqrt2OverPi * (1 + 3 * GELU.CUBIC_COEF * x2)
    );
  }
}
