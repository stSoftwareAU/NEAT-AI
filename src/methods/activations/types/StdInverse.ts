import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * StdInverse Activation Function
 *
 * f(x) = 1 / x
 * f⁻¹(y) = 1 / y
 *
 * Avoids division by near-zero and NaN. Returns 0 for input = 0.
 */
export class StdInverse implements ActivationInterface, UnSquashInterface {
  public static NAME = "StdInverse";

  public static readonly rangeStatic = new ActivationRange(
    StdInverse.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = StdInverse.rangeStatic;

  getName(): string {
    return StdInverse.NAME;
  }

  squash(x: number): number {
    // Handle NaN explicitly
    if (!Number.isFinite(x)) return 0;

    // Avoid division by very small numbers
    const safeX = Math.abs(x) < 1e-15 ? (x > 0 ? 1e-15 : -1e-15) : x;

    const result = 1 / safeX;

    // Ensure result is finite before limiting
    return Number.isFinite(result) ? StdInverse.rangeStatic.limit(result) : 0;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (!Number.isFinite(activation) || Math.abs(activation) < 1e-15) {
      if (typeof hint === "number" && Number.isFinite(hint)) return hint;
      return activation > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
    }

    return 1 / activation;
  }
}
