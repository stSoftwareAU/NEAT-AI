/**
 * Cosine activation function
 * Squash function: f(x) = cos(x)
 * Range: [-1, 1]
 * Source: Custom (Cosine is a standard mathematical function)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Trigonometric_functions#Cosine
 * https://en.wikipedia.org/wiki/Inverse_trigonometric_functions#Arccosine
 */
import { assert } from "@std/assert";
import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import type { SimplifyBiasInterface } from "../../../optimize/SimplifyBiasInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

export class Cosine
  implements
    ActivationInterface,
    UnSquashInterface,
    InlineSquashInterface,
    SimplifyBiasInterface {
  public static NAME = "Cosine";
  public readonly range: ActivationRange = new ActivationRange(
    Cosine.NAME,
    -1,
    1,
  );

  getName() {
    return Cosine.NAME;
  }

  simplifyBias(bias: number): number {
    const tmp = bias % (2 * Math.PI);
    return tmp;
  }

  inlineSquash(value: string): string {
    return `Math.cos(${value})`;
  }

  squash(x: number) {
    return Math.cos(x);
  }

  unSquash(activation: number, hint: number = 0): number {
    // Validate input
    if (!Number.isFinite(hint)) {
      hint = 0;
    }

    assert(
      activation >= -1 && activation <= 1,
      `Activation ${activation} is out of range [-1, 1]`,
    );

    const principal = Math.acos(activation);
    const period = 2 * Math.PI;

    const solutions: number[] = [];
    const hintPeriods = Math.round(hint / period);

    // Explore ±4 periods around the hint
    for (let i = -4; i <= 4; i++) {
      const base = (hintPeriods + i) * period;

      const sol1 = principal + base;
      const sol2 = -principal + base;

      if (Math.abs(Math.cos(sol1) - activation) < 1e-10) {
        solutions.push(sol1);
      }
      if (Math.abs(Math.cos(sol2) - activation) < 1e-10) {
        solutions.push(sol2);
      }
    }

    if (solutions.length === 0) {
      const fallback1 = principal + hintPeriods * period;
      const fallback2 = -principal + hintPeriods * period;
      return Math.abs(fallback1 - hint) < Math.abs(fallback2 - hint)
        ? fallback1
        : fallback2;
    }

    return solutions.reduce((best, current) =>
      Math.abs(current - hint) < Math.abs(best - hint) ? current : best
    );
  }

  /**
   * Derivative of the Cosine function.
   *
   * @param x The input value.
   * @returns The derivative of the Cosine function at the given input.
   */
  derivative(x: number): number {
    return -Math.sin(x);
  }

  /**
   * Calculates error for Cosine activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = cos(x)
   *   f′(x) = -sin(x)
   *
   * Strategy:
   *   ✅ Use derivative when slope is stable and non-zero.
   *   🥽 Fallback to unSquash if slope is flat (near π or 0).
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const slope = this.derivative(currentValue);

    if (Math.abs(slope) > 1e-8) {
      const safeSlope = Math.min(Math.max(slope, -50), 50);
      return (targetActivation - currentActivation) * safeSlope;
    }

    // 🥽 Fallback to foggy glasses
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;

    return Math.tanh(error);
  }
}
