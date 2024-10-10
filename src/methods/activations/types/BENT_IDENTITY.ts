import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Bent Identity (BENT_IDENTITY) activation function.
 *
 * The function is defined as f(x) = (sqrt(x^2 + 1) - 1)/2 + x.
 * Its derivative is f'(x) = x / (2 * sqrt(x^2 + 1)) + 1.
 *
 * Note: The unSquash function is implemented using Newton's method for approximation.
 */
export class BENT_IDENTITY implements ActivationInterface, UnSquashInterface {
  public static NAME = "BENT_IDENTITY";
  private static readonly MAX_ITERATIONS = 100; // Maximum iterations for Newton-Raphson
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    let x = activation; // initial guess

    const epsilon = 1e-6;

    for (let i = 0; i < BENT_IDENTITY.MAX_ITERATIONS; i++) {
      if (Math.abs(x) >= 1e153) { // 1e153 is a reasonable threshold to prevent overflow
        return x; // Return x as the best guess if it's too large
      }
      const d = Math.sqrt(x * x + 1);
      const fx = (d - 1) / 2 + x - activation;

      if (Math.abs(fx) < epsilon) {
        break;
      }

      const dfx = x / (2 * d) + 1;
      x = x - fx / dfx;
    }

    return x;
  }

  // range() {
  //   return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  // }

  getName() {
    return BENT_IDENTITY.NAME;
  }

  squash(x: number) {
    if (Math.abs(x) >= 1e153) { // 1e153 is a reasonable threshold to prevent overflow
      return x; // Return x as the best guess if it's too large
    }
    const d = Math.sqrt(Math.pow(x, 2) + 1);

    const value = (d - 1) / 2 + x;
    return this.range.limit(value);
  }
}
