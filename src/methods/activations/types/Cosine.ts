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
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import { ErrorHelper } from "../../../propagate/ErrorHelper.ts";

export class Cosine
  implements
    ActivationInterface,
    UnSquashInterface,
    InlineSquashInterface,
    SimplifyBiasInterface {
  public mutationProbability = 2;
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
   * Calculates error for COSINE activation with derivative fallback.
   *
   * Summary:
   *   f(x)   = cos(x)
   *   f′(x)  = -sin(x)
   *   f⁻¹(y) = acos(y)
   *
   * Strategy:
   *   ✅ Use derivative when slope is stable (|sin(x)| > ε)
   *   🥽 Fall back to unSquash when slope is near 0 (e.g., at x ≈ 0, π, 2π)
   *   🔒 Clamp result to avoid overshoot
   *
   * Notes:
   *   - Derivative vanishes at peaks (cos(x) ≈ ±1), causing risk of large error.
   *   - acos() is fast and accurate, making fallback safe.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    const slope = this.derivative(currentValue);

    let error: number;
    if (Math.abs(slope) > 1e-8) {
      error = rawError / slope;
    } else {
      const targetValue = this.unSquash(targetActivation, currentValue);
      error = targetValue - currentValue;
    }

    return ErrorHelper.calculateClampedError(error);
  }
}
