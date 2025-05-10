import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Inverse Square Root Unit (ISRU) Activation Function
 *
 * f(x) = x / sqrt(1 + α * x²)
 * f⁻¹(y) = y / sqrt(1 - α * y²)
 *
 * Helps control the magnitude of activations and is useful for preventing exploding gradients.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Activation_function#Inverse_Square_Root_Unit_(ISRU)
 */
export class ISRU implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "ISRU";
  private static readonly ALPHA = 1.0;

  private static readonly MAX_ACTIVATION = 1 / Math.sqrt(ISRU.ALPHA);

  public readonly range = new ActivationRange(
    ISRU.NAME,
    -ISRU.MAX_ACTIVATION,
    ISRU.MAX_ACTIVATION,
  );

  getName(): string {
    return ISRU.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const result = x / Math.sqrt(1 + ISRU.ALPHA * Math.pow(x, 2));
    return this.range.limit(result);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const safeActivation = Math.min(
      Math.max(activation, -ISRU.MAX_ACTIVATION + 1e-10),
      ISRU.MAX_ACTIVATION - 1e-10,
    );

    return safeActivation /
      Math.sqrt(1 - ISRU.ALPHA * Math.pow(safeActivation, 2));
  }

  /**
   * The derivative of the ISRU (Inverse Square Root Unit) function:
   *
   * f(x) = x / sqrt(1 + alpha * x²)
   * f'(x) = (1 + alpha * x²)^(-3/2)
   *
   * Reference: https://arxiv.org/pdf/1710.10753.pdf
   */
  derivative(x: number): number {
    const x2 = x * x;
    const denom = 1 + ISRU.ALPHA * x2;

    // Prevent division by zero or numerical instability
    if (denom < 1e-12) return 0;

    return Math.pow(denom, -1.5);
  }

  /**
   * Calculates error for ISRU activation using derivative or fallback.
   *
   * Summary:
   *   f(x) = x / √(1 + αx²)
   *   f′(x) = (1 + αx²)^(-3/2)
   *   f⁻¹(y) = y / √(1 - αy²)
   *
   * Strategy:
   *   ✅ Use derivative if slope is safe and finite.
   *   🥽 Fallback to unSquash-based error only if slope ≈ 0 (very large x).
   *
   * Notes:
   *   - Derivative is smooth and well-behaved for all finite x.
   *   - Safe to use derivative in most cases for performance.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;
    const slope = this.derivative(currentValue);

    if (Math.abs(slope) > 1e-8) {
      const safeSlope = Math.max(Math.min(slope, 50), -50);

      return rawError * safeSlope;
    }

    // 🥽 Fallback to unSquash only if slope is ~0 (extreme x)
    const targetValue = this.unSquash(targetActivation, currentValue);
    const error = targetValue - currentValue;
    return Math.tanh(error);
  }
}
