import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Swish (SiLU) Activation Function
 *
 * f(x) = x * sigmoid(x) = x / (1 + exp(-x))
 *
 * Reference:
 * https://arxiv.org/abs/1710.05941
 */
export class Swish implements ActivationInterface, UnSquashInterface {
  public static readonly NAME = "Swish";
  private static readonly MAX_ITERATIONS = 100;
  private static readonly EPSILON = 1e-6;

  public static readonly rangeStatic: ActivationRange = new ActivationRange(
    Swish.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  public readonly range = Swish.rangeStatic;

  getName(): string {
    return Swish.NAME;
  }

  squash(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const expNegX = x < -20 ? 0 : Math.exp(-x);
    const value = x / (1 + expNegX);
    return Swish.rangeStatic.limit(value);
  }

  /**
   * Attempts to compute the inverse of the Swish function using the Newton-Raphson method.
   * This is not commonly required for neural network applications, but can be useful
   * for analytical purposes or specific scenarios where the pre-activation value needs to be inferred.
   * @param activation The output value from the Swish function.
   * @param hint An optional initial guess for the Newton-Raphson method.
   * @returns The estimated input value that would produce the given activation output.
   */
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    let x = hint !== undefined
      ? hint
      : (activation >= 0 ? activation : activation / 2);

    for (let i = 0; i < Swish.MAX_ITERATIONS; i++) {
      const expNegX = x < -20 ? 0 : Math.exp(-x);
      const denom = 1 + expNegX;
      const sigmoidX = 1 / denom;
      const fx = x * sigmoidX - activation;

      if (Math.abs(fx) < Swish.EPSILON) {
        break;
      }

      const dSigmoid = expNegX / (denom * denom);
      const dfx = sigmoidX + x * -dSigmoid;

      const nextX = x -
        fx / (Math.abs(dfx) > 1e-8 ? dfx : Math.sign(dfx) * 1e-8);

      if (!Number.isFinite(nextX)) {
        return typeof hint === "number" && Number.isFinite(hint) ? hint : 0;
      }

      x = nextX;
    }

    return x;
  }

  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new Error(`Non-finite input to ${this.getName()}.derivative: ${x}`);
    }

    const sigmoid = 1 / (1 + Math.exp(-x));
    const swishDerivative = sigmoid + x * sigmoid * (1 - sigmoid);

    return Number.isFinite(swishDerivative) ? swishDerivative : 0;
  }

  calculateError(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number {
    const rawError = targetActivation - currentActivation;

    // We can only use the derivative form
    const slope = this.derivative(hint ?? 0); // fallback if hint missing

    const safeSlope = Number.isFinite(slope)
      ? Math.abs(slope) < 1e-8 ? 0 : Math.min(Math.max(slope, -50), 50)
      : Math.sign(slope);

    return rawError * safeSlope;
  }
}
