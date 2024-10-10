import { assert } from "@std/assert/assert";
import type { AbstractActivationInterface } from "../methods/activations/AbstractActivationInterface.ts";

/** Correct the target activation to a possible activation */
type NormalizeFunction = (targetActivation: number) => number;

export class ActivationRange {
  readonly low: number;
  readonly high: number;
  private readonly squash: AbstractActivationInterface;
  public readonly normalize?: NormalizeFunction;

  constructor(
    squash: AbstractActivationInterface,
    low: number,
    high: number,
    normalize?: NormalizeFunction,
  ) {
    this.squash = squash;
    assert(low < high, "ActivationRange: low must be less than high");
    this.low = low;
    this.high = high;
    this.normalize = normalize;
  }

  validate(activation: number, hint?: number) {
    if (
      !Number.isFinite(activation) || activation < this.low ||
      activation > this.high
    ) {
      const msg =
        `${this.squash.getName()}: Activation ${activation} is outside the valid range [${this.low}, ${this.high}] ${
          hint !== undefined ? `with hint ${hint}` : ""
        }`;
      console.error(msg);
      console.trace();
      throw new Error(msg);
    }
  }

  limit(activation: number, hint?: number): number {
    if (Number.isFinite(activation) == false) {
      throw new Error(
        `${this.squash.getName()}: limit: activation is not finite: ${activation}${
          hint !== undefined ? ` with hint ${hint}` : ""
        }`,
      );
    }
    // Clamp the activation to the range [low, high]
    return Math.max(this.low, Math.min(this.high, activation));
  }
}
