import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * TAN Activation Function
 *
 * f(x) = tan(x)
 * f⁻¹(y) = atan(y) + πk, where k ∈ ℤ
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Trigonometric_functions#Tangent
 */
export class TAN
  implements
    ActivationInterface,
    UnSquashInterface,
    InlineSquashInterface,
    SimplifyBiasInterface {
  public static readonly NAME = "TAN";

  public readonly range: ActivationRange = new ActivationRange(
    TAN.NAME,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  getName(): string {
    return TAN.NAME;
  }

  simplifyBias(bias: number): number {
    return bias % Math.PI;
  }

  inlineSquash(value: string): string {
    return `Math.tan(${value})`;
  }

  squash(x: number): number {
    const result = Math.tan(x);
    return Number.isFinite(result) ? result : 0;
  }

  unSquash(activation: number, hint?: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be finite.");
    }

    const baseValue = Math.atan(activation);

    if (hint !== undefined && Number.isFinite(hint)) {
      const difference = hint - baseValue;
      const adjustment = Math.round(difference / Math.PI) * Math.PI;
      return baseValue + adjustment;
    }

    return baseValue;
  }
}
