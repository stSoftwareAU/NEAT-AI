import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

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

  unSquash(activation: number): number {
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

  range() {
    return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  }

  getName() {
    return BENT_IDENTITY.NAME;
  }

  squash(x: number) {
    if (Math.abs(x) >= 1e153) { // 1e153 is a reasonable threshold to prevent overflow
      return x; // Return x as the best guess if it's too large
    }
    const d = Math.sqrt(Math.pow(x, 2) + 1);

    return (d - 1) / 2 + x;
  }
}
