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
    assert(
      high <= Number.MAX_SAFE_INTEGER,
      "ActivationRange: high must be less than or equal to Number.MAX_SAFE_INTEGER",
    );
    assert(
      low >= Number.MIN_SAFE_INTEGER,
      "ActivationRange: low must be greater than or equal to Number.MIN_SAFE_INTEGER",
    );
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

  limit(activation: number, rawInput?: number): number {
    let value = activation;
    if (Number.isFinite(value) === false) {
      if (value === Infinity) {
        value = this.high;
      } else if (value === -Infinity) {
        value = this.low;
      } else {
        throw new Error(
          `${this.name}: Activation ${activation} is not finite, rawInput: ${rawInput}`,
        );
      }
    }

    // Clamp the activation to the range [low, high]
    return Math.max(this.low, Math.min(this.high, value));
  }
}
