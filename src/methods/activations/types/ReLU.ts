import type { InlineSquashInterface } from "../../../optimize/InlineSquashInterface.ts";
import { ActivationRange } from "../../../propagate/ActivationRange.ts";
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
   * Calculate the error based on the current and target activations.
   * In the active zone, we treat it like identity: error = target - current.
   * In the inactive (flat) zone, we fallback to "foggy glasses" i.e., calculate
   * raw error using inverse.
   *
   * @param currentActivation The current activation value.
   * @param targetActivation The target activation value.
   * @param hint Optional hint for unSquash.
   * @returns The calculated error.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    if (currentActivation > 0) {
      // When ReLU is active, we treat it like identity: error = target - current
      return targetActivation - currentActivation;
    } else {
      // In the inactive (flat) zone, derivative is 0 — fallback to "foggy glasses"
      // i.e., calculate raw error using inverse
      return this.unSquash(targetActivation, hint) -
        this.unSquash(currentActivation, hint);
    }
  }
}
