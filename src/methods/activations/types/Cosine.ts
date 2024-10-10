/**
 * Cosine activation function
 * Squash function: f(x) = cos(x)
 * Range: [-1, 1]
 * Source: Custom (Cosine is a standard mathematical function)
 */
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class Cosine implements ActivationInterface, UnSquashInterface {
  public static NAME = "Cosine";
  public readonly range: ActivationRange = new ActivationRange(this, -1, 1);

  getName() {
    return Cosine.NAME;
  }

  squash(x: number) {
    return Math.cos(x);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const acos = Math.acos(activation);

    // If no hint is provided, return the value in the range [0, π]
    if (hint === undefined) {
      return acos;
    }

    // If a hint is provided, return the value with the same sign as the hint
    return hint >= 0 ? Math.abs(acos) : -Math.abs(acos);
  }
}
