import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Cube Nonlinearity Activation Function
 *
 * The Cube function raises the input to the power of three (x^3).
 * It is a simple polynomial activation function that can help capture more complex relationships in data.
 * The derivative is calculated as 3 * x^2.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Power_function
 */
export class Cube
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static NAME = "Cube";

  // Safe maximum input value to prevent overflow when cubing
  private static readonly MAX_INPUT = Math.cbrt(Number.MAX_SAFE_INTEGER);

  public readonly range: ActivationRange = new ActivationRange(
    Cube.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  // Function to estimate the input from the activation value (inverse of the cube function).
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // The inverse of the cube function is the cube root
    return Math.cbrt(activation);
  }

  getName() {
    return Cube.NAME;
  }

  // Cube function definition
  squash(x: number) {
    // Clip the input to the safe maximum range to avoid overflow
    const clippedX = Math.max(-Cube.MAX_INPUT, Math.min(x, Cube.MAX_INPUT));
    return clippedX ** 3;
  }

  inlineSquash(value: string): string {
    return `Math.pow(${value}, 3)`;
  }
}
