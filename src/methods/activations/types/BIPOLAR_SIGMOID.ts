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

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(
        `${this.getName()}.derivative received non-finite input: ${x}`,
      );
    }
    const fx = this.squash(x);
    return 0.5 * (1 + fx) * (1 - fx);
  }
}
