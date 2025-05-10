import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import { ERROR_EPSILON } from "../AbstractActivationInterface.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * ReLU (Rectified Linear Unit) Activation Function
 *
 * f(x) = max(0, x)
 * f⁻¹(y) = y (if y > 0), otherwise use hint or return 0
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)
 */
export class ReLU
  implements ActivationInterface, UnSquashInterface, InlineSquashInterface {
  public static readonly NAME = "ReLU";

  public readonly range = new ActivationRange(
    ReLU.NAME,
    0,
    Number.MAX_VALUE,
  );

  getName(): string {
    return ReLU.NAME;
  }

  inlineSquash(value: string): string {
    return `Math.max(0, (${value}))`;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const value = Math.max(0, x);
    return this.range.limit(value);
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }
    return x > 0 ? 1 : 0;
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation > 0) {
      return activation;
    }

    return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
  }

  /**
   * Calculates error for ReLU (Rectified Linear Unit).
   *
   * Summary:
   *   f(x) = max(0, x)
   *   f′(x) = 1 if x > 0, 0 otherwise
   *
   * Strategy:
   *   ✅ Uses slope = 1 when ReLU is active (x > 0)
   *   🥽 Falls back to unSquash in the inactive (flat) region
   *
   * Notes:
   *   - ReLU has a dead zone for x ≤ 0 where the gradient is 0.
   *   - To propagate error when ReLU is inactive, we estimate via unSquash.
   *   - This approach balances correctness and speed for training.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;
    if (currentActivation > 0) {
      // When ReLU is active, we treat it like identity: error = target - current
      return rawError;
    } else {
      // In the inactive (flat) zone, derivative is 0 — fallback to "foggy glasses"
      // i.e., calculate raw error using inverse
      return this.unSquash(targetActivation, currentValue) -
        currentValue;
    }
  }
}
