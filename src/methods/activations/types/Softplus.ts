import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Softplus Activation Function
 *
 * f(x) = log(1 + exp(x))
 * f⁻¹(y) = log(exp(y) - 1)
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Rectifier_(neural_networks)#Softplus
 */
export class Softplus implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "Softplus";

  private static readonly LARGE_THRESHOLD = 100;
  private static readonly SMALL_THRESHOLD = 1e-15;

  public static readonly rangeStatic = new ActivationRange(
    Softplus.NAME,
    Softplus.SMALL_THRESHOLD,
    Softplus.LARGE_THRESHOLD,
  );

  public readonly range = Softplus.rangeStatic;

  getName(): string {
    return Softplus.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return Softplus.SMALL_THRESHOLD;

    if (x >= 709) {
      return Softplus.LARGE_THRESHOLD;
    }

    const value = Math.log(1 + Math.exp(x));
    return Softplus.rangeStatic.limit(value);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    if (activation < Softplus.SMALL_THRESHOLD) {
      return 0; // Treat as flat zone
    }

    const expA = Math.exp(activation);
    const diff = expA - 1;

    if (diff <= 0 || !Number.isFinite(diff)) {
      return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
    }

    return Math.log(diff);
  }
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    const d = 1 / (1 + Math.exp(-x)); // sigmoid(x)
    return Number.isFinite(d) ? d : 0;
  }
}
