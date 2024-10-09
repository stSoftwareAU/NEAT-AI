/**
 * Cosine activation function
 * Squash function: f(x) = cos(x)
 * Range: [-1, 1]
 * Source: Custom (Cosine is a standard mathematical function)
 */
import { assert } from "@std/assert/assert";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class Cosine implements ActivationInterface, UnSquashInterface {
  public static NAME = "Cosine";

  getName() {
    return Cosine.NAME;
  }

  squash(x: number) {
    return Math.cos(x);
  }

  unSquash(activation: number, hint?: number): number {
    if (!Number.isFinite(activation)) {
      throw new Error("Activation must be a finite number");
    }

    const range = this.range();
    assert(
      Number.isFinite(activation) &&
        activation >= range.low &&
        activation <= range.high,
    );

    const acos = Math.acos(activation);

    // If no hint is provided, return the value in the range [0, π]
    if (hint === undefined) {
      return acos;
    }

    // If a hint is provided, return the value with the same sign as the hint
    return hint >= 0 ? Math.abs(acos) : -Math.abs(acos);
  }

  range() {
    return { low: -1, high: 1 };
  }
}
