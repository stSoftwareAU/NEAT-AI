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
export class Cube implements ActivationInterface, UnSquashInterface {
  public static NAME = "Cube";

  public readonly range: ActivationRange = new ActivationRange(
    this,
    -Infinity,
    Infinity,
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
    return x ** 3;
  }
}
