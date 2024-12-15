import { assert } from "@std/assert/assert";

/** Correct the target activation to a possible activation */
type NormalizeFunction = (targetActivation: number) => number;

export class ActivationRange {
  readonly low: number;
  readonly high: number;
  private readonly name: string;

  constructor(
    name: string,
    low: number,
    high: number,
  ) {
    this.name = name;
    assert(low < high, "ActivationRange: low must be less than high");
    this.low = low;
    this.high = high;
  }

  validate(activation: number, hint?: number) {
    if (
      !Number.isFinite(activation) || activation < this.low ||
      activation > this.high
    ) {
      const msg =
        `${this.name}: Activation ${activation} is outside the valid range [${this.low}, ${this.high}] ${
          hint !== undefined ? `with hint ${hint}` : ""
        }`;

      throw new Error(msg);
    }
  }

  limit(activation: number, hint?: number): number {
    if (Number.isFinite(activation) == false) {
      throw new Error(
        `${this.name}: limit: activation is not finite: ${activation}${
          hint !== undefined ? ` with hint ${hint}` : ""
        }`,
      );
    }
    // Clamp the activation to the range [low, high]
    return Math.max(this.low, Math.min(this.high, activation));
  }
}
